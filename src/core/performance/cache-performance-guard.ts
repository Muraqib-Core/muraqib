import { BaseGuard } from "../base-guard.js";
import type { AuditContext, AuditResult } from "../types.js";
import { runPerformanceAudit } from "./auditor.js";

/**
 * Checks the cache max-age and compression settings read from the environment.
 * Severity levels used: warning.
 */
export class CachePerformanceGuard extends BaseGuard {
  constructor(context?: AuditContext) {
    super("cache-performance-guard", context);
  }

  async execute(): Promise<AuditResult> {
    const perf = runPerformanceAudit();
    if (typeof perf === "object" && perf !== null && !perf.isOptimized) {
      const reports = perf.reports ?? ["Performance cache issues detected"];
      const issues = reports.map((message) =>
        this.createIssue("CACHE_SETTINGS", "warning", "Cache performance issue", message, undefined, undefined, ["performance", "cache"])
      );
      return this.issues(issues, `${issues.length} cache performance issue(s)`);
    }
    return this.ok("Cache and compression settings are optimal");
  }
}
