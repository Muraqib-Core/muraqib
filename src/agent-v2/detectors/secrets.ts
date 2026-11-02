import { createHash } from "node:crypto";
import type { AgentIssue } from "../../agent/types.js";
import { findSecrets } from "../../core/secret-detector.js";
import { scanProjectFiles } from "../../utils/file-scanner.js";

/** Module name under which agent-v2 reports hardcoded secrets found in source files. */
export const SECRETS_MODULE = "agent-v2-secrets" as const;

/**
 * Finds secret literals hardcoded in `.ts` / `.js` source. Read-only: it reuses the v1
 * `findSecrets` matcher but never modifies v1. The issue records the secret's type and
 * location only - the secret value (even masked) is never copied into the issue.
 *
 * @param projectRoot - Project root to scan
 * @returns Issues sorted by file then line
 */
export function detectHardcodedSecrets(projectRoot: string): AgentIssue[] {
  const issues: AgentIssue[] = [];
  for (const file of scanProjectFiles(projectRoot, ["ts", "js"], { includeTests: false })) {
    const relative = file.relativePath.split("\\").join("/");
    const matches = findSecrets(file.content, { file: relative, includeHeuristics: false, ignorePlaceholders: true });
    for (const match of matches) {
      if (match.type === "pii") continue;
      const code = `SECRET_${match.type.toUpperCase()}`;
      const line = match.line;
      const id = createHash("sha1")
        .update([SECRETS_MODULE, code, relative, line ?? ""].join("\u0000"))
        .digest("hex")
        .slice(0, 12);
      const issue: AgentIssue = {
        id,
        module: SECRETS_MODULE,
        code,
        severity: match.blocking ? "critical" : "warning",
        title: "Hardcoded secret in source",
        message: `${match.description} hardcoded in ${relative}${line === undefined ? "" : `:${line}`}`,
        file: relative,
        recommendation: "Move the value to an environment variable and rotate the exposed secret",
        tags: ["secret", "agent-v2"],
      };
      if (line !== undefined) issue.line = line;
      issues.push(issue);
    }
  }
  return issues.sort((a, b) => (a.file ?? "").localeCompare(b.file ?? "") || (a.line ?? 0) - (b.line ?? 0) || a.id.localeCompare(b.id));
}
