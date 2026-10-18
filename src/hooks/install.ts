/**
 * Installs and removes Muraqib's managed blocks in the repository's git hooks.
 *
 * Respects `core.hooksPath` and Husky: existing hook files are edited in place (never replaced) and
 * only Muraqib's marked block is ever added or removed.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { runGit } from "../core/helpers/git-protection.js";
import { toPosix } from "../shared/paths.js";
import { DEFAULT_BIN, HOOK_NAMES, isShellHook, removeHookBlock, upsertHookBlock } from "./hook-script.js";
import type { HookName } from "./hook-script.js";

/** Where hooks live for a repository, and why. */
export interface HooksLocation {
  gitRoot: string;
  /** Directory the hook files are written to. */
  dir: string;
  /** `git`: the default `.git/hooks`; `hooksPath`: `core.hooksPath`; `husky`: Husky's tracked hook directory. */
  kind: "git" | "hooksPath" | "husky";
}

/** What happened to one hook file. */
export interface HookOutcome {
  hook: HookName;
  file: string;
  action: "created" | "appended" | "updated" | "unchanged" | "removed" | "deleted" | "absent" | "skipped";
  /** Why a hook was skipped. */
  reason?: string;
}

/** Hooks selected by the user; pre-commit is always part of an install. */
export interface InstallOptions {
  preCommit?: boolean;
  prePush?: boolean;
}

function expandHome(value: string): string {
  return value === "~" || value.startsWith("~/") ? path.join(os.homedir(), value.slice(1)) : value;
}

/** Husky v9 generates stubs in `.husky/_` and runs the editable hooks from `.husky`; edit those. */
function huskyEditableDir(hooksPath: string): string | undefined {
  const isStubDir = path.basename(hooksPath) === "_" && path.basename(path.dirname(hooksPath)) === ".husky";
  if (isStubDir) return path.dirname(hooksPath);
  return path.basename(hooksPath) === ".husky" ? hooksPath : undefined;
}

/**
 * Work out where git runs hooks from.
 *
 * @param cwd - Any directory inside the repository
 * @returns The hooks directory and how it was chosen
 * @throws When `cwd` is not inside a git work tree
 */
export function resolveHooksLocation(cwd: string): HooksLocation {
  const top = runGit(["rev-parse", "--show-toplevel"], cwd);
  const gitRoot = top.stdout.trim();
  if (top.status !== 0 || gitRoot === "") throw new Error("Not a git repository (run this inside a project that uses git).");

  const configured = runGit(["config", "--get", "core.hooksPath"], gitRoot).stdout.trim();
  if (configured !== "") {
    const dir = path.resolve(gitRoot, expandHome(configured));
    const husky = huskyEditableDir(dir);
    return husky ? { gitRoot, dir: husky, kind: "husky" } : { gitRoot, dir, kind: "hooksPath" };
  }
  return { gitRoot, dir: defaultHooksDir(gitRoot), kind: "git" };
}

/** `<git dir>/hooks` ignoring `core.hooksPath` (shared by linked worktrees via the common git dir). */
function defaultHooksDir(gitRoot: string): string {
  const commonDir = runGit(["rev-parse", "--git-common-dir"], gitRoot).stdout.trim();
  return path.resolve(gitRoot, commonDir === "" ? ".git" : commonDir, "hooks");
}

function selectedHooks(options: InstallOptions): HookName[] {
  return HOOK_NAMES.filter((hook) => (hook === "pre-commit" ? options.preCommit !== false : options.prePush === true));
}

function readIfExists(file: string): string | undefined {
  try {
    return fs.readFileSync(file, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
}

/** Project-local Muraqib binary relative to the repository root, if the project has one. */
function localBin(gitRoot: string, projectRoot: string): string {
  const candidate = path.join(projectRoot, "node_modules", ".bin", "muraqib");
  const relative = toPosix(path.relative(gitRoot, candidate));
  return fs.existsSync(candidate) && !relative.startsWith("..") ? relative : DEFAULT_BIN;
}

function installOne(location: HooksLocation, hook: HookName, bin: string): HookOutcome {
  const file = path.join(location.dir, hook);
  const existing = readIfExists(file);
  if (existing !== undefined && !isShellHook(existing)) {
    return { hook, file, action: "skipped", reason: "the existing hook is not a shell script; add `muraqib hook run " + hook + "` to it by hand" };
  }
  const edit = upsertHookBlock(existing, hook, bin);
  if (edit.action === "unchanged") return { hook, file, action: "unchanged" };

  fs.mkdirSync(location.dir, { recursive: true });
  fs.writeFileSync(file, edit.content);
  fs.chmodSync(file, fs.statSync(file).mode | 0o111);
  return { hook, file, action: edit.action === "created" ? "created" : edit.action === "appended" ? "appended" : "updated" };
}

/**
 * Install the Muraqib hooks (idempotent).
 *
 * @param cwd - Directory inside the repository
 * @param options - `prePush: true` adds the opt-in pre-push audit; pre-commit is always installed
 * @returns Where hooks live and what happened to each file
 * @throws When `cwd` is not in a git repository or an existing block is malformed
 */
export function installHooks(cwd: string, options: InstallOptions = {}): { location: HooksLocation; outcomes: HookOutcome[] } {
  const location = resolveHooksLocation(cwd);
  const bin = localBin(location.gitRoot, path.resolve(cwd));
  return { location, outcomes: selectedHooks(options).map((hook) => installOne(location, hook, bin)) };
}

function uninstallOne(dir: string, hook: HookName): HookOutcome {
  const file = path.join(dir, hook);
  const existing = readIfExists(file);
  if (existing === undefined) return { hook, file, action: "absent" };
  const edit = removeHookBlock(existing, hook);
  if (edit.action === "absent") return { hook, file, action: "absent" };
  if (edit.empty) {
    fs.unlinkSync(file);
    return { hook, file, action: "deleted" };
  }
  fs.writeFileSync(file, edit.content);
  return { hook, file, action: "removed" };
}

/**
 * Remove the Muraqib hooks. Every managed hook is removed unless `prePush` is the only one asked for.
 * The default `.git/hooks` directory is checked too, so blocks left from before `core.hooksPath` was set are cleaned up.
 *
 * @param cwd - Directory inside the repository
 * @param options - `prePush: true` removes only the pre-push block
 * @returns Where hooks live and what happened to each file that held a block
 */
export function uninstallHooks(cwd: string, options: InstallOptions = {}): { location: HooksLocation; outcomes: HookOutcome[] } {
  const location = resolveHooksLocation(cwd);
  const hooks: HookName[] = options.prePush === true && options.preCommit !== true ? ["pre-push"] : [...HOOK_NAMES];
  const dirs = [...new Set([location.dir, defaultHooksDir(location.gitRoot)])];
  const outcomes = dirs.flatMap((dir) => hooks.map((hook) => uninstallOne(dir, hook)));
  // Report "absent" only once per hook, and only when no directory held a block.
  const kept = outcomes.filter((outcome) => outcome.action !== "absent");
  const missing = hooks
    .filter((hook) => !kept.some((outcome) => outcome.hook === hook))
    .map((hook): HookOutcome => ({ hook, file: path.join(location.dir, hook), action: "absent" }));
  return { location, outcomes: [...kept, ...missing] };
}
