import type { AuditResult } from "./types.js";

/**
 * Compute the process exit code for a set of audit results.
 *
 * - `3`: a scanner failed (`scan.exitCode === 3`); takes precedence over everything.
 * - `1`: blocking findings: scan flags (`hasBlockingIssues` / `exitCode === 1`), any critical or
 *   error issue, or any warning when `failOnWarning` is set. A crashed guard emits a
 *   `GUARD_ERROR` (severity error) issue, so it counts as blocking and yields exit 1.
 * - `0`: otherwise.
 */
export function auditExitCode(results: readonly AuditResult[], failOnWarning = false): 0 | 1 | 3 {
  if (results.some((result) => result.scan?.exitCode === 3)) return 3;
  const blocking = results.some((result) =>
    result.scan?.hasBlockingIssues || result.scan?.exitCode === 1 || result.issues.some((issue) =>
      issue.severity === "critical" || issue.severity === "error" || (failOnWarning && issue.severity === "warning")
    )
  );
  return blocking ? 1 : 0;
}
