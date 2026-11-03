import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentIssue } from "../../agent/types.js";
import { scanProjectFiles } from "../../utils/file-scanner.js";
import { ENV_MARKER, loadIgnoreMatcher } from "../ignore.js";

/** Module name under which agent-v2 reports environment-variable documentation gaps. */
export const ENV_MODULE = "agent-v2-env" as const;

const ENV_EXAMPLE = ".env.example";
/** Variables every runtime provides; documenting them is noise. */
const BUILTIN_VARS: ReadonlySet<string> = new Set(["NODE_ENV", "CI"]);
const ENV_USAGE = /(?:process\.env|import\.meta\.env)(?:\.([A-Za-z_][A-Za-z0-9_]*)|\[\s*["']([A-Za-z_][A-Za-z0-9_]*)["']\s*\])/g;

/** `const { A, B: renamed, C = "x", ...rest } = process.env` on one line; group 1 is the text between the braces. */
const ENV_DESTRUCTURE = /\b(?:const|let|var)\s*\{([^{}]*)\}\s*=\s*(?:process\.env|import\.meta\.env)\b/g;
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

interface EnvUsage {
  file: string;
  line: number;
}

function makeId(code: string, file: string, key: string): string {
  return createHash("sha1").update([ENV_MODULE, code, file, key].join("\u0000")).digest("hex").slice(0, 12);
}

/** Variable names declared in `.env.example` (a `KEY=` or `# KEY=` line counts as documented). */
export function readDocumentedKeys(projectRoot: string): Set<string> | undefined {
  const path = join(projectRoot, ENV_EXAMPLE);
  if (!existsSync(path)) return undefined;
  const keys = new Set<string>();
  for (const raw of readFileSync(path, "utf-8").split(/\r?\n/)) {
    const match = /^\s*#?\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(raw);
    if (match?.[1] !== undefined) keys.add(match[1]);
  }
  return keys;
}

/** Variable names read by one destructuring pattern. Renames and defaults keep the env name; `...rest` is skipped. */
function destructuredNames(pattern: string): string[] {
  const names: string[] = [];
  for (const part of pattern.split(",")) {
    const name = part.split(/[:=]/)[0]?.trim() ?? "";
    if (IDENTIFIER.test(name)) names.push(name);
  }
  return names;
}

/** Every environment variable named on one source line, by `process.env.X`, `process.env["X"]` or destructuring. */
function namesOnLine(text: string): string[] {
  const names: string[] = [];
  for (const match of text.matchAll(ENV_USAGE)) {
    const key = match[1] ?? match[2];
    if (key !== undefined) names.push(key);
  }
  for (const match of text.matchAll(ENV_DESTRUCTURE)) names.push(...destructuredNames(match[1] ?? ""));
  return names;
}

/**
 * First usage (file, line) of every environment variable read in source. Lines containing
 * `muraqib-ignore-env` and files listed in `.muraqibignore` do not count as usages.
 */
export function collectUsages(projectRoot: string): Map<string, EnvUsage> {
  const usages = new Map<string, EnvUsage>();
  const files = scanProjectFiles(projectRoot, ["ts", "js"], { includeTests: false });
  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  const isIgnored = loadIgnoreMatcher(projectRoot);
  for (const file of files) {
    const relative = file.relativePath.split("\\").join("/");
    if (isIgnored?.(relative) === true) continue;
    file.content.split(/\r?\n/).forEach((text, index) => {
      if (text.includes(ENV_MARKER)) return;
      for (const key of namesOnLine(text)) {
        if (BUILTIN_VARS.has(key) || usages.has(key)) continue;
        usages.set(key, { file: relative, line: index + 1 });
      }
    });
  }
  return usages;
}

/**
 * Compares the environment variables the source reads against `.env.example`.
 * Reports `ENV_EXAMPLE_MISSING` (once) when the file does not exist, otherwise one
 * `ENV_UNDOCUMENTED` per variable the file does not mention. Reads names only, never values.
 *
 * @param projectRoot - Project root to scan
 * @returns Issues in variable-name order
 */
export function detectUndocumentedEnv(projectRoot: string): AgentIssue[] {
  const usages = collectUsages(projectRoot);
  if (usages.size === 0) return [];
  const documented = readDocumentedKeys(projectRoot);
  const names = [...usages.keys()].sort();

  if (documented === undefined) {
    return [
      {
        id: makeId("ENV_EXAMPLE_MISSING", ENV_EXAMPLE, ""),
        module: ENV_MODULE,
        code: "ENV_EXAMPLE_MISSING",
        severity: "warning",
        title: "Missing .env.example",
        message: `Source reads ${names.length} environment variable(s) (${names.join(", ")}) but ${ENV_EXAMPLE} does not exist`,
        file: ENV_EXAMPLE,
        recommendation: `Create ${ENV_EXAMPLE} listing every variable with a placeholder value`,
        tags: ["env", "agent-v2"],
      },
    ];
  }

  const issues: AgentIssue[] = [];
  for (const name of names) {
    const usage = usages.get(name);
    if (usage === undefined || documented.has(name)) continue;
    issues.push({
      id: makeId("ENV_UNDOCUMENTED", usage.file, name),
      module: ENV_MODULE,
      code: "ENV_UNDOCUMENTED",
      severity: "warning",
      title: "Undocumented environment variable",
      message: `${name} is read in ${usage.file}:${usage.line} but missing from ${ENV_EXAMPLE}`,
      file: usage.file,
      line: usage.line,
      recommendation: `Add ${name}= with a placeholder to ${ENV_EXAMPLE}`,
      tags: ["env", "agent-v2"],
    });
  }
  return issues;
}
