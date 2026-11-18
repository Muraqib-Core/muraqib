import { BaseGuard } from "../core/base-guard.js";
import type { AuditContext, AuditResult } from "../core/types.js";
import { runComprehensiveBundleAudit } from "./bundle-budget.js";

/**
 * Checks source files against the 14 KB first-round-trip budget.
 * Severity levels used: warning. A project with no measurable source files is reported as skipped, never as a pass.
 */
export class BundleBudgetGuard extends BaseGuard {
  private readonly targetPath: string;

  constructor(targetPath: string, context?: AuditContext) {
    super("bundle-budget-guard", context);
    this.targetPath = targetPath;
  }

  async execute(): Promise<AuditResult> {
    const bundle = runComprehensiveBundleAudit(this.targetPath);
    const issues = [
      ...bundle.violations.map((v) =>
        this.createIssue(
          "BUNDLE_BUDGET_EXCEEDED",
          "warning",
          "Source file over the bundle budget",
          `${v.filePath} (${v.sizeKB} KB > ${v.limitKB} KB budget)`,
          { file: v.filePath },
          "Split the file or lazy-load part of it to stay within the budget.",
          ["performance", "bundle"]
        )
      ),
      ...bundle.projectIssues.map((message) =>
        this.createIssue("BUNDLE_PROJECT_ISSUE", "warning", "Bundle configuration issue", message, undefined, undefined, ["performance", "bundle"])
      ),
    ];

    if (issues.length > 0) return this.issues(issues, `${issues.length} bundle budget issue(s)`);
    if (bundle.skipped) return this.skipped("No JS/TS/Svelte/Vue source files found — nothing was measured");
    return this.ok(`All ${bundle.scannedFiles} source file(s) are within the budget`);
  }
}
