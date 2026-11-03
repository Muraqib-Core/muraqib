import { spawn } from "node:child_process";
import { existsSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { containsSecret, redactText } from "../explain/redact.js";
import { applyEdits, copyProject, removeCopy } from "./project-copy.js";
import type { ProposedFix } from "./types.js";

/** Default time limit of one verify command, in milliseconds. */
export const DEFAULT_VERIFY_TIMEOUT_MS = 120_000;
/** Lines of command output shown after a failure. */
const OUTPUT_LINES = 20;
/** Output kept in memory per run (the tail is what matters). */
const CAPTURE_KIB = 64;
const BYTES_PER_KIB = 1024;
const MAX_CAPTURE = CAPTURE_KIB * BYTES_PER_KIB;
const MS_PER_SECOND = 1000;
/** Environment variables never handed to a verify command. */
const HIDDEN_ENV: readonly string[] = ["GEMINI_API_KEY", "GOOGLE_API_KEY"];
/** Warning text when the command already fails on the unmodified project. */
export const BASELINE_FAILING = "verify-cmd baseline already failing - not used";

/** Result of running one command once. */
export interface CommandRun {
  ok: boolean;
  /** Why it failed, in the form `exit 1`, `timed out after 5s` or `could not start: ...`. Empty on success. */
  detail: string;
  /** Last lines of combined stdout/stderr (raw, not yet redacted). */
  output: string;
}

/** What the commands said about an accepted fix: which passed and which could not be used. */
export interface CommandSummary {
  passed: string[];
  warnings: string[];
}

/** Verdict of {@link CommandChecker.check}. A rejection carries the redacted output tail. */
export type CommandCheckOutcome =
  | { ok: true; summary: CommandSummary }
  | { ok: false; reason: string; output: string; summary: CommandSummary };

/** Options of {@link CommandChecker}. */
export interface CommandCheckerOptions {
  /** Shell commands given by the user, run in order. */
  commands: readonly string[];
  timeoutMs: number;
  /** The real project: its `node_modules` is linked into every temp copy. Never written to. */
  projectRoot: string;
  /** Test hook: creates the `node_modules` link. Defaults to a dir symlink (junction on Windows). */
  link?: ((target: string, path: string) => void) | undefined;
}

/** The environment a command sees: the parent env without the Gemini/Google API keys. Never logged. */
export function commandEnv(parent: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...parent };
  for (const name of HIDDEN_ENV) delete env[name];
  return env;
}

function defaultLink(target: string, path: string): void {
  symlinkSync(target, path, process.platform === "win32" ? "junction" : "dir");
}

function killTree(pid: number | undefined): void {
  if (pid === undefined) return;
  try {
    if (process.platform === "win32") spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }).on("error", () => undefined);
    else process.kill(-pid, "SIGKILL");
  } catch {
    // process already gone
  }
}

function tail(text: string): string {
  return text.split(/\r?\n/).filter((l) => l.trim() !== "").slice(-OUTPUT_LINES).join("\n");
}

/**
 * Runs `command` through the platform shell in `cwd`. The user wrote the command, so `shell: true` is
 * intended. On timeout the whole process tree is killed (process group on POSIX, `taskkill /T /F` on Windows).
 *
 * @param command - Shell command line
 * @param cwd - Folder to run in
 * @param timeoutMs - Kill after this many milliseconds
 * @returns Success flag, failure detail and the raw output tail
 */
export function runCommand(command: string, cwd: string, timeoutMs: number): Promise<CommandRun> {
  return new Promise((resolve) => {
    let captured = "";
    let settled = false;
    const done = (run: Omit<CommandRun, "output">): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ...run, output: tail(captured) });
    };
    const child = spawn(command, { cwd, shell: true, env: commandEnv(), detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    const timer = setTimeout(() => {
      killTree(child.pid);
      child.stdout?.destroy();
      child.stderr?.destroy();
      done({ ok: false, detail: `timed out after ${Math.round(timeoutMs / MS_PER_SECOND)}s` });
    }, timeoutMs);
    const collect = (chunk: Buffer): void => {
      captured = (captured + chunk.toString("utf-8")).slice(-MAX_CAPTURE);
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.on("error", (error) => done({ ok: false, detail: `could not start: ${error.message}` }));
    child.on("close", (code, signal) => done(code === 0 ? { ok: true, detail: "" } : { ok: false, detail: code === null ? `signal ${signal ?? "unknown"}` : `exit ${code}` }));
  });
}

/**
 * Last ~20 lines of output, redacted; a line that still looks like a secret becomes `(line hidden)`.
 *
 * @param output - Raw command output
 * @returns Text that is safe to show
 */
export function safeOutput(output: string): string {
  return tail(output).split("\n").filter((l) => l !== "").map((line) => {
    const redacted = redactText(line);
    return containsSecret(redacted) ? "(line hidden)" : redacted;
  }).join("\n");
}

/**
 * Optional stronger verification: runs user-supplied commands (for example a type-check or the tests)
 * on a temp copy of the project with the fix applied. Each command is first run once on the unmodified
 * copy; if that fails, the command cannot judge a fix and is not used. The baseline is cached for the
 * whole session. The real project is never modified (its `node_modules` is only linked).
 */
export class CommandChecker {
  private readonly baselines = new Map<string, Promise<CommandRun>>();

  constructor(private readonly options: CommandCheckerOptions) {}

  /**
   * Checks a fix against the commands.
   *
   * @param workRoot - Project folder the fix applies to (the session's working tree)
   * @param fix - The fix that passed the audit verification
   * @returns ok with the commands that passed and warnings, or a rejection with reason and redacted output
   */
  async check(workRoot: string, fix: ProposedFix): Promise<CommandCheckOutcome> {
    const summary: CommandSummary = { passed: [], warnings: [] };
    const copy = copyProject(workRoot);
    try {
      this.linkModules(copy, summary);
      const usable: string[] = [];
      for (const command of this.options.commands) {
        if (await this.baseline(command, copy)) usable.push(command);
        else summary.warnings.push(`${BASELINE_FAILING}: ${command}`);
      }
      applyEdits(copy, fix.edits);
      for (const command of usable) {
        const run = await runCommand(command, copy, this.options.timeoutMs);
        if (!run.ok) return { ok: false, reason: `verify command failed: ${command} (${run.detail})`, output: safeOutput(run.output), summary };
        summary.passed.push(command);
      }
      return { ok: true, summary };
    } finally {
      removeCopy(copy);
    }
  }

  /** True when the command passes on the unmodified copy; computed once per command per session. */
  private async baseline(command: string, copy: string): Promise<boolean> {
    let run = this.baselines.get(command);
    if (run === undefined) {
      run = runCommand(command, copy, this.options.timeoutMs);
      this.baselines.set(command, run);
    }
    return (await run).ok;
  }

  private linkModules(copy: string, summary: CommandSummary): void {
    const target = join(this.options.projectRoot, "node_modules");
    if (!existsSync(target)) return;
    try {
      (this.options.link ?? defaultLink)(target, join(copy, "node_modules"));
    } catch (error) {
      summary.warnings.push(`node_modules could not be linked into the copy (${error instanceof Error ? error.message : "unknown error"}); commands may fail to find tools`);
    }
  }
}
