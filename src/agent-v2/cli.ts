import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { formatPlanJson, formatPlanText } from "./format.js";
import { runFixCli } from "./fix-cli.js";
import { runAgent } from "./loop.js";

const USAGE = `Usage: muraqib-agent <plan|fix> [options]   (see: muraqib-agent fix --help)

  muraqib-agent plan [options]

Options:
  --project <path>   Project root (default: current directory)
  --json             Print the plan as JSON instead of text
  --max-steps <n>    Keep only the first n steps
  --module <name>    Limit the v1 audit to a module (repeatable)
  -h, --help         Show this help

Exit codes: 0 plan produced, 2 usage error, 3 audit could not run.
`;

interface ParsedArgs {
  project: string;
  json: boolean;
  maxSteps?: number;
  modules: string[];
}

function parseArgs(args: readonly string[]): ParsedArgs | string {
  const parsed: ParsedArgs = { project: process.cwd(), json: false, modules: [] };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const value = (): string | undefined => {
      i += 1;
      return args[i];
    };
    if (arg === "--json") parsed.json = true;
    else if (arg === "--project") {
      const v = value();
      if (v === undefined) return "--project needs a path";
      parsed.project = resolve(v);
    } else if (arg === "--module") {
      const v = value();
      if (v === undefined) return "--module needs a name";
      parsed.modules.push(v);
    } else if (arg === "--max-steps") {
      const n = Number(value());
      if (!Number.isInteger(n) || n < 0) return "--max-steps needs a non-negative integer";
      parsed.maxSteps = n;
    } else return `Unknown argument: ${arg ?? ""}`;
  }
  return parsed;
}

/** CLI entry for `muraqib-agent`. Returns the process exit code; writes the plan to stdout. */
export async function runAgentCli(args: readonly string[]): Promise<number> {
  const [command, ...rest] = args;
  if (command === undefined || command === "-h" || command === "--help") {
    process.stdout.write(USAGE);
    return command === undefined ? 2 : 0;
  }
  if (command === "fix") return runFixCli(rest);
  if (command !== "plan") {
    process.stderr.write(`Unknown command: ${command}\n${USAGE}`);
    return 2;
  }
  const parsed = parseArgs(rest);
  if (typeof parsed === "string") {
    process.stderr.write(`${parsed}\n${USAGE}`);
    return 2;
  }
  if (!existsSync(parsed.project) || !statSync(parsed.project).isDirectory()) {
    process.stderr.write(`Project path not found or not a directory: ${parsed.project}\n`);
    return 2;
  }
  const { plan } = await runAgent("plan", {
    projectRoot: parsed.project,
    modules: parsed.modules.length > 0 ? parsed.modules : undefined,
    maxSteps: parsed.maxSteps,
  });
  process.stdout.write(parsed.json ? formatPlanJson(plan) : formatPlanText(plan));
  return plan.ok ? 0 : 3;
}
