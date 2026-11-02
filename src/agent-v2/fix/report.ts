import type { FixSessionResult } from "./session.js";

/** Human-readable fix report. Contains titles, files and warnings only - never a secret value. */
export function formatFixReport(result: FixSessionResult, patchPath?: string): string {
  if (!result.ok) return `Muraqib agent fix failed: ${result.error ?? "unknown error"}\n`;
  const lines = [`Muraqib agent fix (${result.mode})`, ""];
  if (result.outcomes.length === 0) lines.push("No fixes were produced.");
  for (const o of result.outcomes) {
    lines.push(`[${o.status}] ${o.fix.title}`);
    if (o.note !== undefined) lines.push(`   ${o.note}`);
    if (o.verification !== undefined && !o.verification.accepted) {
      for (const key of [...o.verification.stillPresent, ...o.verification.introduced]) lines.push(`   - ${key.split("|").slice(0, 3).join(" | ")}`);
    }
    for (const warning of o.fix.warnings) lines.push(`   WARNING: ${warning}`);
  }
  for (const d of result.decisions) {
    lines.push("", `Decision needed for ${d.issueId}: ${d.question}`);
    for (const option of d.options) lines.push(`   ${option.key}: ${option.label}   (--choose ${d.issueId}=${option.key})`);
  }
  for (const s of result.skipped) lines.push("", `Skipped ${s.issueId}: ${s.reason}`);
  if (patchPath !== undefined) lines.push("", `Patch written to ${patchPath} (apply with: git apply ${patchPath})`);
  return `${lines.join("\n")}\n`;
}
