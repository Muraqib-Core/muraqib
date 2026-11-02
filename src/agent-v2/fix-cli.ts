import { existsSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { createFixBranch } from "./fix/apply.js";
import { DEFAULT_FIXERS } from "./fix/registry.js";
import { formatFixReport } from "./fix/report.js";
import { runFixSession } from "./fix/session.js";
import type { FixMode, ProposedFix } from "./fix/types.js";

export const FIX_USAGE = `Usage: muraqib-agent fix [options]

Options:
  --project <path>         Project root (default: current directory)
  --dry-run                Propose only: write a patch file (default)
  --apply                  Apply fixes on a new git branch, asking before each one
  --out <file>             Patch file for propose mode (default: muraqib-agent.patch)
  --choose <id>=<option>   Answer a decision (repeatable)
  --max-fixes <n>          Stop after n accepted fixes

Every fix is verified by re-running the audit on a copy: it is kept only if the issue
disappears and no new issue appears. Exit codes: 0 done, 2 usage error, 3 audit failed.
`;

interface FixArgs {
  project: string;
  mode: FixMode;
  out: string;
  choices: Map<string, string>;
  maxFixes?: number;
}

function parseFixArgs(args: readonly string[]): FixArgs | string {
  const parsed: FixArgs = { project: process.cwd(), mode: "propose", out: "muraqib-agent.patch", choices: new Map() };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const next = (): string | undefined => {
      i += 1;
      return args[i];
    };
    if (arg === "--dry-run") parsed.mode = "propose";
    else if (arg === "--apply") parsed.mode = "apply";
    else if (arg === "--project") {
      const v = next();
      if (v === undefined) return "--project needs a path";
      parsed.project = resolve(v);
    } else if (arg === "--out") {
      const v = next();
      if (v === undefined) return "--out needs a file";
      parsed.out = v;
    } else if (arg === "--choose") {
      const match = /^([^=]+)=(.+)$/.exec(next() ?? "");
      if (match?.[1] === undefined || match[2] === undefined) return "--choose needs <id>=<option>";
      parsed.choices.set(match[1], match[2]);
    } else if (arg === "--max-fixes") {
      const n = Number(next());
      if (!Number.isInteger(n) || n < 0) return "--max-fixes needs a non-negative integer";
      parsed.maxFixes = n;
    } else return `Unknown argument: ${arg ?? ""}`;
  }
  return parsed;
}

async function askApproval(fix: ProposedFix): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const files = fix.edits.map((e) => e.file).join(", ");
    for (const warning of fix.warnings) process.stderr.write(`WARNING: ${warning}\n`);
    return /^y(es)?$/i.test((await rl.question(`Apply "${fix.title}" (${files})? [y/N] `)).trim());
  } finally {
    rl.close();
  }
}

/** `muraqib-agent fix`: returns the process exit code. */
export async function runFixCli(args: readonly string[]): Promise<number> {
  if (args.includes("-h") || args.includes("--help")) {
    process.stdout.write(FIX_USAGE);
    return 0;
  }
  const parsed = parseFixArgs(args);
  if (typeof parsed === "string") {
    process.stderr.write(`${parsed}\n${FIX_USAGE}`);
    return 2;
  }
  if (!existsSync(parsed.project) || !statSync(parsed.project).isDirectory()) {
    process.stderr.write(`Project path not found or not a directory: ${parsed.project}\n`);
    return 2;
  }
  if (parsed.mode === "apply") {
    if (!process.stdin.isTTY) {
      process.stderr.write("apply mode asks for approval of every fix and needs an interactive terminal\n");
      return 2;
    }
    const branch = createFixBranch(parsed.project);
    if (!branch.ok) {
      process.stderr.write(`${branch.reason}\n`);
      return 2;
    }
    process.stderr.write(`Working on new branch ${branch.branch} (changes are not committed)\n`);
  }
  const result = await runFixSession({ projectRoot: parsed.project, mode: parsed.mode, choices: parsed.choices, fixers: DEFAULT_FIXERS, approve: askApproval, maxFixes: parsed.maxFixes });
  let patchPath: string | undefined;
  if (parsed.mode === "propose" && result.patch !== "") {
    patchPath = resolve(parsed.out);
    writeFileSync(patchPath, result.patch, "utf-8");
  }
  process.stdout.write(formatFixReport(result, patchPath));
  return result.ok ? 0 : 3;
}
