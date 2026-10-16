/**
 * Configuration Guard - Validates project configuration files
 *
 * Helpers wired in from `./helpers`:
 * - `tsconfig-parser`: JSONC-aware, `extends`-aware tsconfig compiler options.
 * - `git-protection`: detects environment files that are committed to version control.
 * - `env-parser`: counts the variables a committed environment file defines.
 * - `secret-detector`: tells real secret values from placeholders, so only exposed secrets escalate.
 */
import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";
import { BaseGuard } from "./base-guard.js";
import type { AuditResult, AuditIssue, AuditContext } from "./types.js";
import { readCompilerOptions } from "./helpers/tsconfig-parser.js";
import { trackedEnvFiles, isGitIgnored } from "./helpers/git-protection.js";
import { isExposedEnvValue } from "./helpers/secret-detector.js";
import { getSensitiveMuraqibEnvKeys } from "./env-options.js";
import { parseEnvEntries } from "./helpers/env-parser.js";
import type { EnvEntry } from "./helpers/env-parser.js";

export interface ConfigIssue {
  type:
    | "missing_config"
    | "invalid_json"
    | "unsafe_setting"
    | "missing_dependency"
    | "conflicting_config"
    | "outdated_config"
    | "tracked_env_file"
    | "exposed_secret";
  file: string;
  setting?: string;
  severity: "critical" | "high" | "medium" | "low";
  message: string;
  suggestion: string;
}

export interface ConfigAuditResult {
  isHealthy: boolean;
  reports: string[];
  issues: ConfigIssue[];
  configFiles: {
    found: string[];
    missing: string[];
  };
}

interface ConfigAuditOptions {
  projectRoot?: string | undefined;
}

const criticalConfigs = [
  "tsconfig.json",
  "package.json",
  ".gitignore",
  ".eslintignore",
];
/** ESLint flat config files (ESLint 9+); they declare ignores themselves and ESLint no longer reads `.eslintignore`. */
const ESLINT_FLAT_CONFIGS = [
  "eslint.config.js",
  "eslint.config.mjs",
  "eslint.config.cjs",
  "eslint.config.ts",
  "eslint.config.mts",
  "eslint.config.cts",
];
const optionalConfigs = [
  ...ESLINT_FLAT_CONFIGS,
  ".eslintrc.js",
  "prettier.config.js",
  "vitest.config.ts",
  "vite.config.ts",
];

/** Matches `.env`, `.env.local`, `.env.production`, ... */
const ENV_FILE_PATTERN = /^\.env(?:\..+)?$/;
/** Matches templates that are meant to be committed, such as `.env.example`. */
const ENV_TEMPLATE_PATTERN = /\.(?:example|sample|template|dist|defaults?)$/i;

/** Parses an env file into entries; returns `[]` when it cannot be read. */
function readEnvEntries(filePath: string): EnvEntry[] {
  try {
    return parseEnvEntries(readFileSync(filePath, "utf-8"));
  } catch {
    return [];
  }
}

/** Names of entries whose values look like real secrets (values are never reported). */
function exposedKeys(entries: readonly EnvEntry[], sensitiveKeys: ReadonlySet<string>): string[] {
  return entries.filter((e) => isExposedEnvValue(e.key, e.value, sensitiveKeys)).map((e) => e.key);
}

/** Lists non-template env files directly inside `root`. */
function localEnvFiles(root: string): string[] {
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isFile() && ENV_FILE_PATTERN.test(d.name) && !ENV_TEMPLATE_PATTERN.test(d.name))
      .map((d) => d.name);
  } catch {
    return [];
  }
}

/**
 * Audits environment files (templates excluded):
 * - tracked by version control with secret-looking values -> critical `exposed_secret`;
 * - tracked without secret-looking values -> high `tracked_env_file`;
 * - present, not tracked, not ignored and holding secret-looking values -> high `exposed_secret`.
 * Ignored, untracked files are the normal local setup and are never reported. Secret values are
 * never copied into messages; only variable names are.
 */
function checkEnvFiles(root: string, issues: ConfigIssue[], reports: string[]): void {
  const sensitiveKeys = new Set(getSensitiveMuraqibEnvKeys());
  const tracked = trackedEnvFiles(root, ENV_FILE_PATTERN, ENV_TEMPLATE_PATTERN);

  for (const file of tracked) {
    const entries = readEnvEntries(join(root, file));
    // An unreadable or empty env file exposes nothing, so it is not worth a finding.
    if (entries.length === 0) continue;
    const secrets = exposedKeys(entries, sensitiveKeys);
    if (secrets.length > 0) {
      issues.push({
        type: "exposed_secret",
        file,
        severity: "critical",
        message: `Environment file ${file} is tracked by version control and contains secret-looking values for: ${secrets.join(", ")}`,
        suggestion: `Rotate these secrets, untrack the file ("git rm --cached ${file}"), add it to .gitignore and purge it from history`,
      });
      reports.push(`🔴 Secrets committed in ${file}`);
    } else {
      issues.push({
        type: "tracked_env_file",
        file,
        severity: "high",
        message: `Environment file ${file} is tracked by version control and defines ${entries.length} variable(s)`,
        suggestion: `Untrack it ("git rm --cached ${file}"), add it to .gitignore and commit a .env.example template instead`,
      });
      reports.push(`🔴 Tracked environment file: ${file}`);
    }
  }

  for (const file of localEnvFiles(root)) {
    if (tracked.includes(file) || isGitIgnored(root, file)) continue;
    const secrets = exposedKeys(readEnvEntries(join(root, file)), sensitiveKeys);
    if (secrets.length === 0) continue;
    issues.push({
      type: "exposed_secret",
      file,
      severity: "high",
      message: `Environment file ${file} is not git-ignored and contains secret-looking values for: ${secrets.join(", ")}`,
      suggestion: `Add ${file} to .gitignore before committing and keep real secrets out of version control`,
    });
    reports.push(`⚠️ Unignored environment file with secrets: ${file}`);
  }
}

/** Extracts a message from an unknown thrown value. */
function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** True when the directory holds at least one `.ts`/`.tsx` file directly inside it. */
function hasTypeScriptFiles(dir: string): boolean {
  try {
    return readdirSync(dir, { withFileTypes: true }).some((d) => d.isFile() && /\.tsx?$/.test(d.name));
  } catch {
    return false;
  }
}

/** A project is considered TypeScript when package.json lists `typescript` or `.ts`/`.tsx` files exist in the root or `src`. */
function hasTypeScriptSignals(root: string, pkg: Record<string, unknown> | undefined): boolean {
  for (const field of ["dependencies", "devDependencies"] as const) {
    const deps = pkg?.[field];
    if (isRecord(deps) && "typescript" in deps) return true;
  }
  return hasTypeScriptFiles(root) || hasTypeScriptFiles(join(root, "src"));
}

type CompilerOptions = ReturnType<typeof readCompilerOptions>;

/** A declarative check on a parsed config file: when `isViolated` holds, `issue` (and `report`) are emitted. */
interface SettingRule<Source> {
  issue: Omit<ConfigIssue, "type">;
  report?: string;
  isViolated: (source: Source) => boolean;
}

const TSCONFIG_RULES: readonly SettingRule<CompilerOptions>[] = [
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

type PackageJson = Record<string, unknown>;

/** Reads `pkg[field]` as a record, or `undefined` when it is absent or not an object. */
function recordField(pkg: PackageJson, field: string): Record<string, unknown> | undefined {
  const value = pkg[field];
  return isRecord(value) ? value : undefined;
}

const PACKAGE_RULES: readonly SettingRule<PackageJson>[] = [
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
function applyRules<Source>(
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

/** Severity of a missing critical config; anything not listed is `high`. */
const MISSING_CONFIG_SEVERITY: Readonly<Record<string, ConfigIssue["severity"]>> = {
  // .eslintignore is only a convenience for legacy eslintrc setups, never a blocker
  ".eslintignore": "medium",
  ".gitignore": "medium",
};

function performConfigAuditInternal(projectRoot?: string): ConfigAuditResult {
  const root = projectRoot !== undefined && projectRoot.trim() !== "" ? projectRoot : process.cwd();
  const issues: ConfigIssue[] = [];
  const reports: string[] = [];
  const configFiles = { found: [] as string[], missing: [] as string[] };

  const usesFlatEslintConfig = ESLINT_FLAT_CONFIGS.some((name) => existsSync(join(root, name)));

  // package.json and tsconfig.json are each parsed exactly once and reused below.
  let pkg: Record<string, unknown> | undefined;
  let compilerOptions: CompilerOptions | undefined;

  // package.json is read up front: the TypeScript signals decide how severe a missing tsconfig is.
  const packagePath = join(root, "package.json");
  let packageParseError: string | undefined;
  if (existsSync(packagePath)) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(packagePath, "utf-8"));
      if (isRecord(parsed)) pkg = parsed;
    } catch (e) {
      packageParseError = errorMessage(e);
    }
  }

  // Check critical configs
  for (const config of criticalConfigs) {
    if (config === ".eslintignore" && usesFlatEslintConfig) continue;
    const configPath = join(root, config);
    if (!existsSync(configPath)) {
      configFiles.missing.push(config);
      if (config === "tsconfig.json" && !hasTypeScriptSignals(root, pkg)) {
        issues.push({
          type: "missing_config",
          file: config,
          severity: "low",
          message: `No ${config} found (no TypeScript signals detected, so this is only informational)`,
          suggestion: "Add a tsconfig.json if you adopt TypeScript or use editor type-checking (checkJs)",
        });
        reports.push(`ℹ️ No ${config} (project does not appear to use TypeScript)`);
        continue;
      }
      issues.push({
        type: "missing_config",
        file: config,
        severity: MISSING_CONFIG_SEVERITY[config] ?? "high",
        message: `Critical configuration file missing: ${config}`,
        suggestion: `Create or copy ${config} to project root`,
      });
      reports.push(`❌ Missing critical config: ${config}`);
    } else {
      configFiles.found.push(config);

      // Validate JSON configs
      if (config.endsWith(".json")) {
        try {
          if (config === "tsconfig.json") {
            // tsconfig is JSONC (comments, trailing commas) and may extend other files.
            compilerOptions = readCompilerOptions(configPath);
          } else if (packageParseError !== undefined) {
            throw new Error(packageParseError);
          } else if (config !== "package.json") {
            JSON.parse(readFileSync(configPath, "utf-8"));
          }
          reports.push(`✅ Valid JSON: ${config}`);
        } catch (e) {
          issues.push({
            type: "invalid_json",
            file: config,
            severity: "critical",
            message: `Invalid JSON in ${config}: ${errorMessage(e)}`,
            suggestion: "Fix JSON syntax errors in the configuration file",
          });
          reports.push(`🔴 Invalid JSON in ${config}`);
        }
      }
    }
  }

  // Check optional configs
  for (const config of optionalConfigs) {
    const configPath = join(root, config);
    if (existsSync(configPath)) {
      configFiles.found.push(config);
      reports.push(`ℹ️ Found optional config: ${config}`);
    }
  }

  // Validate tsconfig.json settings (parsed once above; unreadable files were already reported as invalid JSON)
  if (compilerOptions !== undefined) {
    applyRules(TSCONFIG_RULES, compilerOptions, "unsafe_setting", issues, reports);
  }

  // Validate package.json fields (parsed once above; a parse failure was already reported as invalid JSON)
  if (pkg !== undefined) {
    applyRules(PACKAGE_RULES, pkg, "missing_config", issues, reports);
    const testScript = recordField(pkg, "scripts")?.["test"];
    if (testScript) reports.push(`✅ Test script found: ${String(testScript)}`);
  }

  checkEnvFiles(root, issues, reports);

  const isHealthy =
    issues.filter((i) => i.severity === "critical" || i.severity === "high")
      .length === 0;

  if (isHealthy && issues.length === 0) {
    reports.push("✅ All critical configurations are properly set");
  }

  return { isHealthy, reports, issues, configFiles };
}

/** Config severities (`low`..`critical`) expressed on the guard-level scale. */
const AUDIT_SEVERITY: Readonly<Record<ConfigIssue["severity"], AuditIssue["severity"]>> = {
  critical: "critical",
  high: "error",
  medium: "warning",
  low: "info",
};

/**
 * Validates configuration and environment files: missing or invalid variables and unsafe settings.
 * Severity levels used: critical, error, warning, info (config `low` maps to info).
 */
export class ConfigGuard extends BaseGuard {
  private options: ConfigAuditOptions;

  constructor(options: ConfigAuditOptions = {}, context?: AuditContext) {
    super("config-guard", context);
    this.options = options;
  }

  /**
   * Execute.
   *
   * @returns Execute result
   */
  async execute(): Promise<AuditResult> {
    const result = performConfigAuditInternal(this.options.projectRoot);

    const issues: AuditIssue[] = [];

    for (const configIssue of result.issues) {
      const severity = AUDIT_SEVERITY[configIssue.severity];

      issues.push(
        this.createIssue(
          `CONFIG_${configIssue.type.toUpperCase()}`,
          severity,
          `Configuration Issue: ${configIssue.file}${configIssue.setting ? ` › ${configIssue.setting}` : ""}`,
          configIssue.message,
          { file: configIssue.file },
          configIssue.suggestion,
          ["config", configIssue.type, ...(configIssue.setting ? [configIssue.setting] : [])]
        )
      );
    }

    if (issues.length === 0) {
      return this.ok("Configuration is healthy and valid");
    }

    return this.issues(issues, `Found ${issues.length} configuration issue(s)`);
  }
}

/**
 * @deprecated Use ConfigGuard class instead
 */
export function performConfigAudit(projectRoot?: string): ConfigAuditResult {
  return performConfigAuditInternal(projectRoot);
}
