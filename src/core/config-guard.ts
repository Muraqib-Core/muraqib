/**
 * Configuration Guard - Validates project configuration files
 */
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { BaseGuard } from "./base-guard.js";
import type { AuditResult, AuditIssue, AuditContext } from "./types.js";

export interface ConfigIssue {
  type:
    | "missing_config"
    | "invalid_json"
    | "unsafe_setting"
    | "missing_dependency"
    | "conflicting_config"
    | "outdated_config";
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
  projectRoot?: string;
}

const criticalConfigs = [
  "tsconfig.json",
  "package.json",
  ".gitignore",
  ".eslintignore",
];
const optionalConfigs = [
  "eslint.config.js",
  ".eslintrc.js",
  "prettier.config.js",
  "vitest.config.ts",
  "vite.config.ts",
];

function performConfigAuditInternal(projectRoot?: string): ConfigAuditResult {
  const root = projectRoot || process.cwd();
  const issues: ConfigIssue[] = [];
  const reports: string[] = [];
  const configFiles = { found: [] as string[], missing: [] as string[] };

  // Check critical configs
  for (const config of criticalConfigs) {
    const configPath = join(root, config);
    if (!existsSync(configPath)) {
      configFiles.missing.push(config);
      if (config !== ".gitignore") {
        issues.push({
          type: "missing_config",
          file: config,
          severity: "high",
          message: `Critical configuration file missing: ${config}`,
          suggestion: `Create or copy ${config} to project root`,
        });
        reports.push(`❌ Missing critical config: ${config}`);
      }
    } else {
      configFiles.found.push(config);

      // Validate JSON configs
      if (config.endsWith(".json")) {
        try {
          const content = readFileSync(configPath, "utf-8");
          JSON.parse(content);
          reports.push(`✅ Valid JSON: ${config}`);
        } catch (e) {
          issues.push({
            type: "invalid_json",
            file: config,
            severity: "critical",
            message: `Invalid JSON in ${config}: ${(e as Error).message}`,
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

  // Validate tsconfig.json settings
  const tsconfigPath = join(root, "tsconfig.json");
  if (existsSync(tsconfigPath)) {
    try {
      const tsconfig = JSON.parse(readFileSync(tsconfigPath, "utf-8"));

      // Check strict mode
      if (!tsconfig.compilerOptions?.strict) {
        issues.push({
          type: "unsafe_setting",
          file: "tsconfig.json",
          setting: "strict",
          severity: "medium",
          message: "TypeScript strict mode is disabled",
          suggestion: 'Enable strict mode: "strict": true in compilerOptions',
        });
        reports.push("⚠️ TypeScript strict mode disabled");
      }

      // Check for noImplicitAny
      if (tsconfig.compilerOptions?.noImplicitAny === false) {
        issues.push({
          type: "unsafe_setting",
          file: "tsconfig.json",
          setting: "noImplicitAny",
          severity: "high",
          message: "Implicit 'any' types allowed",
          suggestion:
            'Set "noImplicitAny": true to catch type errors early',
        });
        reports.push("⚠️ Implicit any types allowed in TypeScript");
      }
    } catch {
      // Already caught in JSON validation
    }
  }

  // Validate package.json
  const packagePath = join(root, "package.json");
  if (existsSync(packagePath)) {
    try {
      const pkg = JSON.parse(readFileSync(packagePath, "utf-8"));

      if (!pkg.description) {
        issues.push({
          type: "missing_config",
          file: "package.json",
          setting: "description",
          severity: "low",
          message: "Missing package description",
          suggestion: "Add a description field to package.json",
        });
      }

      if (!pkg.license) {
        issues.push({
          type: "missing_config",
          file: "package.json",
          setting: "license",
          severity: "low",
          message: "Missing license field",
          suggestion:
            'Add a license field (e.g., "MIT", "ISC", "Apache-2.0")',
        });
      }

      if (!pkg.engines?.node) {
        issues.push({
          type: "missing_config",
          file: "package.json",
          setting: "engines.node",
          severity: "medium",
          message: "Node.js version not specified",
          suggestion:
            'Add "engines": { "node": ">=18.0.0" } to package.json',
        });
      }

      // Check for test script
      if (!pkg.scripts?.test) {
        issues.push({
          type: "missing_config",
          file: "package.json",
          setting: "scripts.test",
          severity: "medium",
          message: "No test script defined",
          suggestion: 'Add "test" script to scripts section',
        });
        reports.push("⚠️ No test script in package.json");
      } else {
        reports.push(`✅ Test script found: ${pkg.scripts.test}`);
      }
    } catch {
      // Already caught in JSON validation
    }
  }

  const isHealthy =
    issues.filter((i) => i.severity === "critical" || i.severity === "high")
      .length === 0;

  if (isHealthy && issues.length === 0) {
    reports.push("✅ All critical configurations are properly set");
  }

  return { isHealthy, reports, issues, configFiles };
}

export class ConfigGuard extends BaseGuard {
  private options: ConfigAuditOptions;

  constructor(options: ConfigAuditOptions = {}, context?: AuditContext) {
    super("config-guard", context);
    this.options = options;
  }

  async execute(): Promise<AuditResult> {
    const result = performConfigAuditInternal(this.options.projectRoot);

    const issues: AuditIssue[] = [];

    for (const configIssue of result.issues) {
      let severity: AuditIssue["severity"] = "warning";
      if (configIssue.severity === "critical") severity = "critical";
      else if (configIssue.severity === "high") severity = "error";
      else if (configIssue.severity === "medium") severity = "warning";

      issues.push(
        this.createIssue(
          `CONFIG_${configIssue.type.toUpperCase()}`,
          severity,
          `Configuration Issue: ${configIssue.file}`,
          configIssue.message,
          { file: configIssue.file },
          configIssue.suggestion,
          configIssue.setting ? [configIssue.setting] : []
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
