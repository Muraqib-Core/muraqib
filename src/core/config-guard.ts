/**
 * Configuration Guard - Validates project configuration files
 *
 * Helpers wired in from `./helpers`:
 * - `tsconfig-parser`: JSONC-aware, `extends`-aware tsconfig compiler options.
 * - `git-protection`: detects environment files that are committed to version control.
 * - `env-parser`: counts the variables a committed environment file defines.
 * - `secret-detector`: tells real secret values from placeholders, so only exposed secrets escalate.
 *
 * Implementation lives in `config-audit` (orchestration), `config-env-files`, `config-settings`
 * and `config-types`; this module hosts the guard and keeps the public exports.
 */
import { BaseGuard } from "./base-guard.js";
import type { AuditResult, AuditIssue, AuditContext } from "./types.js";
import type { ConfigIssue, ConfigAuditResult } from "./config-types.js";
import { performConfigAuditInternal } from "./config-audit.js";

export type { ConfigIssue, ConfigAuditResult } from "./config-types.js";

interface ConfigAuditOptions {
  projectRoot?: string | undefined;
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
