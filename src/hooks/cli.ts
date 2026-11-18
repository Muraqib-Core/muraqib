/**
 * `muraqib hook <install|uninstall|run>`.
 *
 * Kept free of the rest of the CLI so a git hook starts fast: `bin/muraqib.js` loads this module
 * directly for `hook` commands instead of the full audit CLI.
 */
import path from "path";
import { HOOK_NAMES } from "./hook-script.js";
import type { HookName } from "./hook-script.js";
import { installHooks, uninstallHooks } from "./install.js";
import type { HookOutcome, HooksLocation } from "./install.js";
import { runPreCommit, runPrePush } from "./run.js";

const USAGE = `
USAGE:
  muraqib hook install [--pre-push]     Install the pre-commit secret scan (and, opt-in, the pre-push audit)
  muraqib hook uninstall [--pre-push]   Remove Muraqib's hook blocks (only pre-push with --pre-push)
  muraqib hook run <pre-commit|pre-push>  What the installed hooks execute

OPTIONS:
  -p, --project <path>   Repository directory (default: cwd)
      --pre-push         Also install (or only remove) the heavier pre-push security audit
  -h, --help             Show this help message

The hooks add one marked block to your existing hook files (core.hooksPath and Husky are respected);
nothing else in them is touched. Bypass once with --no-verify, or MURAQIB_SKIP_HOOKS=1.
`;

interface HookArgs {
  action: string | undefined;
  rest: string[];
  prePush: boolean;
  help: boolean;
  project: string;
}

function parseHookArgs(args: string[], cwd: string): HookArgs {
  const parsed: HookArgs = { action: undefined, rest: [], prePush: false, help: false, project: cwd };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    if (arg === "--pre-push") parsed.prePush = true;
    else if (arg === "-h" || arg === "--help") parsed.help = true;
    else if ((arg === "-p" || arg === "--project") && args[i + 1] !== undefined) parsed.project = path.resolve(cwd, args[++i] ?? "");
    else if (parsed.action === undefined) parsed.action = arg;
    else parsed.rest.push(arg);
  }
  return parsed;
}

const LOCATION_LABEL: Record<HooksLocation["kind"], string> = {
  git: "default git hooks directory",
  hooksPath: "core.hooksPath",
  husky: "Husky",
};

function describeOutcome(outcome: HookOutcome, gitRoot: string): string {
  const file = path.relative(gitRoot, outcome.file) || outcome.file;
  const note = outcome.reason === undefined ? "" : ` (${outcome.reason})`;
  return `  ${outcome.action === "skipped" ? "!" : "✔"} ${outcome.hook}: ${outcome.action} ${file}${note}`;
}

function report(location: HooksLocation, outcomes: HookOutcome[]): void {
  console.log(`Hooks directory: ${path.relative(location.gitRoot, location.dir) || "."} (${LOCATION_LABEL[location.kind]})`);
  for (const outcome of outcomes) console.log(describeOutcome(outcome, location.gitRoot));
}

function isHookName(value: string | undefined): value is HookName {
  return HOOK_NAMES.some((name) => name === value);
}

/** `hook run`: only a finding may block; any failure to check is a warning (see {@link runPreCommit}). */
async function runInstalledHook(parsed: HookArgs): Promise<number> {
  const hook = parsed.rest[0];
  if (!isHookName(hook)) {
    console.error(`Unknown hook "${hook ?? ""}". Expected one of: ${HOOK_NAMES.join(", ")}.`);
    return 1;
  }
  try {
    return hook === "pre-commit" ? await runPreCommit(parsed.project) : await runPrePush(parsed.project);
  } catch (error) {
    console.error(`muraqib: ${hook} check failed to run (${error instanceof Error ? error.message : String(error)}), continuing`);
    return 0;
  }
}

/**
 * Run a `muraqib hook ...` command.
 *
 * @param args - Arguments after `hook`
 * @param cwd - Working directory (the repository root when git runs a hook)
 * @returns Process exit code
 */
export async function runHookCli(args: string[], cwd: string = process.cwd()): Promise<number> {
  const parsed = parseHookArgs(args, cwd);
  if (parsed.help || parsed.action === undefined) {
    console.log(USAGE);
    return parsed.help ? 0 : 1;
  }
  try {
    switch (parsed.action) {
      case "install": {
        const { location, outcomes } = installHooks(parsed.project, { prePush: parsed.prePush });
        report(location, outcomes);
        if (!parsed.prePush) console.log("The pre-push audit is opt-in: add it with `muraqib hook install --pre-push`.");
        return outcomes.some((outcome) => outcome.action === "skipped") ? 1 : 0;
      }
      case "uninstall": {
        const { location, outcomes } = uninstallHooks(parsed.project, { prePush: parsed.prePush });
        report(location, outcomes);
        return 0;
      }
      case "run":
        return await runInstalledHook(parsed);
      default:
        console.error(`Unknown hook command "${parsed.action}".`);
        console.log(USAGE);
        return 1;
    }
  } catch (error) {
    console.error("❌ Error:", error instanceof Error ? error.message : String(error));
    return 1;
  }
}
