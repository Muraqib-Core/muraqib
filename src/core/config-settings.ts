/**
 * Declarative setting rules for tsconfig.json and package.json.
 */
import type { readCompilerOptions } from "./helpers/tsconfig-parser.js";
import type { ConfigIssue } from "./config-types.js";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type CompilerOptions = ReturnType<typeof readCompilerOptions>;

/** A declarative check on a parsed config file: when `isViolated` holds, `issue` (and `report`) are emitted. */
interface SettingRule<Source> {
  issue: Omit<ConfigIssue, "type">;
  report?: string;
  isViolated: (source: Source) => boolean;
}

export const TSCONFIG_RULES: readonly SettingRule<CompilerOptions>[] = [
  {
    issue: {
      file: "tsconfig.json",
      setting: "strict",
      severity: "medium",
      message: "TypeScript strict mode is disabled",
      suggestion: 'Enable strict mode: "strict": true in compilerOptions',
    },
    report: "⚠️ TypeScript strict mode disabled",
    isViolated: (options) => !options?.strict,
  },
  {
    issue: {
      file: "tsconfig.json",
      setting: "noImplicitAny",
      severity: "high",
      message: "Implicit 'any' types allowed",
      suggestion: 'Set "noImplicitAny": true to catch type errors early',
    },
    report: "⚠️ Implicit any types allowed in TypeScript",
    isViolated: (options) => options?.noImplicitAny === false,
  },
];

export type PackageJson = Record<string, unknown>;

/** Reads `pkg[field]` as a record, or `undefined` when it is absent or not an object. */
export function recordField(pkg: PackageJson, field: string): Record<string, unknown> | undefined {
  const value = pkg[field];
  return isRecord(value) ? value : undefined;
}

export const PACKAGE_RULES: readonly SettingRule<PackageJson>[] = [
  {
    issue: {
      file: "package.json",
      setting: "description",
      severity: "low",
      message: "Missing package description",
      suggestion: "Add a description field to package.json",
    },
    isViolated: (pkg) => !pkg["description"],
  },
  {
    issue: {
      file: "package.json",
      setting: "license",
      severity: "low",
      message: "Missing license field",
      suggestion: 'Add a license field (e.g., "MIT", "ISC", "Apache-2.0")',
    },
    isViolated: (pkg) => !pkg["license"],
  },
  {
    issue: {
      file: "package.json",
      setting: "engines.node",
      severity: "medium",
      message: "Node.js version not specified",
      suggestion: 'Add "engines": { "node": ">=18.0.0" } to package.json',
    },
    isViolated: (pkg) => !recordField(pkg, "engines")?.["node"],
  },
  {
    issue: {
      file: "package.json",
      setting: "scripts.test",
      severity: "medium",
      message: "No test script defined",
      suggestion: 'Add "test" script to scripts section',
    },
    report: "⚠️ No test script in package.json",
    isViolated: (pkg) => !recordField(pkg, "scripts")?.["test"],
  },
];

/** Applies every violated rule, recording its issue (typed `missing_config`/`unsafe_setting`) and report. */
export function applyRules<Source>(
  rules: readonly SettingRule<Source>[],
  source: Source,
  type: ConfigIssue["type"],
  issues: ConfigIssue[],
  reports: string[]
): void {
  for (const rule of rules) {
    if (!rule.isViolated(source)) continue;
    issues.push({ type, ...rule.issue });
    if (rule.report !== undefined) reports.push(rule.report);
  }
}
