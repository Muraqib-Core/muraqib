import type { AuditResult } from "./types.js";

/** Scanner failures take precedence over policy findings; severity remains unchanged. */
export function auditExitCode(results: readonly AuditResult[], failOnWarning = false): 0 | 1 | 3 {
  if (results.some((result) => result.scan?.exitCode === 3)) return 3;
  const blocking = results.some((result) =>
    result.scan?.hasBlockingIssues || result.scan?.exitCode === 1 || result.issues.some((issue) =>
      issue.severity === "critical" || issue.severity === "error" || (failOnWarning && issue.severity === "warning")
    )
  );
  return blocking ? 1 : 0;
}
