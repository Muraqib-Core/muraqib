/**
 * Config audit: critical/optional config files, JSON validity, setting rules and env files.
 */
import { readFileSync, existsSync } from "fs";
import { readDirEntries } from "../shared/fs-safe.js";
import { join } from "path";
import { readCompilerOptions } from "./helpers/tsconfig-parser.js";
import type { ConfigAuditResult, ConfigIssue } from "./config-types.js";
import { checkEnvFiles } from "./config-env-files.js";
import { TSCONFIG_RULES, PACKAGE_RULES, applyRules, isRecord, recordField } from "./config-settings.js";
import type { CompilerOptions, PackageJson } from "./config-settings.js";

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

/** Extracts a message from an unknown thrown value. */
function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** True when the directory holds at least one `.ts`/`.tsx` file directly inside it. */
function hasTypeScriptFiles(dir: string): boolean {
  return readDirEntries(dir).some((d) => d.isFile() && /\.tsx?$/.test(d.name));
}

/** A project is considered TypeScript when package.json lists `typescript` or `.ts`/`.tsx` files exist in the root or `src`. */
function hasTypeScriptSignals(root: string, pkg: Record<string, unknown> | undefined): boolean {
  for (const field of ["dependencies", "devDependencies"] as const) {
    const deps = pkg?.[field];
    if (isRecord(deps) && "typescript" in deps) return true;
  }
  return hasTypeScriptFiles(root) || hasTypeScriptFiles(join(root, "src"));
}

/** Severity of a missing critical config; anything not listed is `high`. */
const MISSING_CONFIG_SEVERITY: Readonly<Record<string, ConfigIssue["severity"]>> = {
  // .eslintignore is only a convenience for legacy eslintrc setups, never a blocker
  ".eslintignore": "medium",
  ".gitignore": "medium",
};

/** Where checks record what they find. */
interface AuditSink {
  issues: ConfigIssue[];
  reports: string[];
}

/**
 * Reads package.json once. A missing file or a non-object document yields no `pkg`; a syntax error
 * is kept as `parseError` so it can be reported as invalid JSON later.
 */
function readPackageJson(root: string): { pkg: PackageJson | undefined; parseError: string | undefined } {
  const packagePath = join(root, "package.json");
  if (!existsSync(packagePath)) return { pkg: undefined, parseError: undefined };
  try {
    const parsed: unknown = JSON.parse(readFileSync(packagePath, "utf-8"));
    return { pkg: isRecord(parsed) ? parsed : undefined, parseError: undefined };
  } catch (e) {
    return { pkg: undefined, parseError: errorMessage(e) };
  }
}

/** Records a missing critical config; a missing tsconfig is only informational for non-TypeScript projects. */
function reportMissingConfig(config: string, root: string, pkg: PackageJson | undefined, sink: AuditSink): void {
  if (config === "tsconfig.json" && !hasTypeScriptSignals(root, pkg)) {
    sink.issues.push({
      type: "missing_config",
      file: config,
      severity: "low",
      message: `No ${config} found (no TypeScript signals detected, so this is only informational)`,
      suggestion: "Add a tsconfig.json if you adopt TypeScript or use editor type-checking (checkJs)",
    });
    sink.reports.push(`ℹ️ No ${config} (project does not appear to use TypeScript)`);
    return;
  }
  sink.issues.push({
    type: "missing_config",
    file: config,
    severity: MISSING_CONFIG_SEVERITY[config] ?? "high",
    message: `Critical configuration file missing: ${config}`,
    suggestion: `Create or copy ${config} to project root`,
  });
  sink.reports.push(`❌ Missing critical config: ${config}`);
}

/**
 * Checks that an existing `.json` config parses. package.json is not re-read (its parse error was
 * captured up front); tsconfig is parsed as JSONC and its compiler options are returned for rule checks.
 */
function validateJsonConfig(
  config: string,
  configPath: string,
  packageParseError: string | undefined,
  sink: AuditSink
): CompilerOptions | undefined {
  let compilerOptions: CompilerOptions | undefined;
  try {
    if (config === "tsconfig.json") {
      // tsconfig is JSONC (comments, trailing commas) and may extend other files.
      compilerOptions = readCompilerOptions(configPath);
    } else if (packageParseError !== undefined) {
      throw new Error(packageParseError);
    } else if (config !== "package.json") {
      JSON.parse(readFileSync(configPath, "utf-8"));
    }
    sink.reports.push(`✅ Valid JSON: ${config}`);
  } catch (e) {
    sink.issues.push({
      type: "invalid_json",
      file: config,
      severity: "critical",
      message: `Invalid JSON in ${config}: ${errorMessage(e)}`,
      suggestion: "Fix JSON syntax errors in the configuration file",
    });
    sink.reports.push(`🔴 Invalid JSON in ${config}`);
  }
  return compilerOptions;
}

type ConfigFiles = ConfigAuditResult["configFiles"];

/**
 * Checks every critical config (presence, then JSON validity), recording what was found or missing.
 * @returns tsconfig's compiler options when tsconfig.json exists and parses
 */
function auditCriticalConfigs(
  root: string,
  pkg: PackageJson | undefined,
  packageParseError: string | undefined,
  sink: AuditSink,
  configFiles: ConfigFiles
): CompilerOptions | undefined {
  // .eslintignore is meaningless next to a flat config, so it is not required then.
  const usesFlatEslintConfig = ESLINT_FLAT_CONFIGS.some((name) => existsSync(join(root, name)));
  let compilerOptions: CompilerOptions | undefined;

  for (const config of criticalConfigs) {
    if (config === ".eslintignore" && usesFlatEslintConfig) continue;
    const configPath = join(root, config);
    if (!existsSync(configPath)) {
      configFiles.missing.push(config);
      reportMissingConfig(config, root, pkg, sink);
      continue;
    }
    configFiles.found.push(config);
    if (!config.endsWith(".json")) continue;
    const options = validateJsonConfig(config, configPath, packageParseError, sink);
    if (config === "tsconfig.json") compilerOptions = options;
  }
  return compilerOptions;
}

/** Notes the optional configs that are present. */
function noteOptionalConfigs(root: string, sink: AuditSink, configFiles: ConfigFiles): void {
  for (const config of optionalConfigs) {
    if (!existsSync(join(root, config))) continue;
    configFiles.found.push(config);
    sink.reports.push(`ℹ️ Found optional config: ${config}`);
  }
}

/**
 * Applies the setting rules to the already-parsed files. A file that failed to parse was reported as
 * invalid JSON earlier and has nothing to check here.
 */
function checkParsedSettings(pkg: PackageJson | undefined, compilerOptions: CompilerOptions | undefined, sink: AuditSink): void {
  if (compilerOptions !== undefined) {
    applyRules(TSCONFIG_RULES, compilerOptions, "unsafe_setting", sink.issues, sink.reports);
  }
  if (pkg !== undefined) {
    applyRules(PACKAGE_RULES, pkg, "missing_config", sink.issues, sink.reports);
    const testScript = recordField(pkg, "scripts")?.["test"];
    if (testScript) sink.reports.push(`✅ Test script found: ${String(testScript)}`);
  }
}

export function performConfigAuditInternal(projectRoot?: string): ConfigAuditResult {
  const root = projectRoot !== undefined && projectRoot.trim() !== "" ? projectRoot : process.cwd();
  const sink: AuditSink = { issues: [], reports: [] };
  const configFiles: ConfigFiles = { found: [], missing: [] };

  // package.json is read up front: the TypeScript signals decide how severe a missing tsconfig is.
  // package.json and tsconfig.json are each parsed exactly once and reused below.
  const { pkg, parseError } = readPackageJson(root);
  const compilerOptions = auditCriticalConfigs(root, pkg, parseError, sink, configFiles);
  noteOptionalConfigs(root, sink, configFiles);
  checkParsedSettings(pkg, compilerOptions, sink);
  checkEnvFiles(root, sink.issues, sink.reports);

  const { issues, reports } = sink;
  const isHealthy = !issues.some((i) => i.severity === "critical" || i.severity === "high");
  if (isHealthy && issues.length === 0) {
    reports.push("✅ All critical configurations are properly set");
  }
  return { isHealthy, reports, issues, configFiles };
}
