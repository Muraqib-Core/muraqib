import { existsSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildPrDescription } from "./pr-description.js";

/** Usage text of `muraqib-agent pr-description`. */
export const PR_USAGE = `Usage: muraqib-agent pr-description [options]

Writes a PR description (problem, solution, testing) from the real verification result.
Nothing in the project is modified.

Options:
  --project <path>         Project root (default: current directory)
  --choose <id>=<option>   Answer a decision (repeatable)
  --json                   Print { title, body } as JSON
  --out <file>             Write the description to a file instead of stdout
`;

interface PrArgs {
  project: string;
  json: boolean;
  out?: string;
  choices: Map<string, string>;
}

function parsePrArgs(args: readonly string[]): PrArgs | string {
  const parsed: PrArgs = { project: process.cwd(), json: false, choices: new Map() };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const next = (): string | undefined => {
      i += 1;
      return args[i];
    };
    if (arg === "--json") parsed.json = true;
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
    } else return `Unknown argument: ${arg ?? ""}`;
  }
  return parsed;
}

/** `muraqib-agent pr-description`: returns the process exit code (0 done, 2 usage error). */
export async function runPrDescriptionCli(args: readonly string[]): Promise<number> {
  if (args.includes("-h") || args.includes("--help")) {
    process.stdout.write(PR_USAGE);
    return 0;
  }
  const parsed = parsePrArgs(args);
  if (typeof parsed === "string") {
    process.stderr.write(`${parsed}\n${PR_USAGE}`);
    return 2;
  }
  if (!existsSync(parsed.project) || !statSync(parsed.project).isDirectory()) {
    process.stderr.write(`Project path not found or not a directory: ${parsed.project}\n`);
    return 2;
  }
  const description = await buildPrDescription({ projectRoot: parsed.project, choices: parsed.choices });
  const text = parsed.json ? `${JSON.stringify(description, null, 2)}\n` : `Title: ${description.title}\n\n${description.body}`;
  if (parsed.out === undefined) process.stdout.write(text);
  else writeFileSync(resolve(parsed.out), text, "utf-8");
  return 0;
}
