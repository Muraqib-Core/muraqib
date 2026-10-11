/**
 * Terminal-UI-free helpers behind the post-report actions of the interactive audit:
 * de-duplicated fixes ranked by severity, and a paste-ready prompt for an AI assistant.
 */
import type { AuditReport } from "./types.js";

export type SeverityName = "critical" | "error" | "warning" | "info";

/** Most to least severe. */
export const SEVERITY_ORDER: readonly SeverityName[] = ["critical", "error", "warning", "info"];

export interface FlatIssue {
  module: string;
  severity: SeverityName;
  title: string;
  message: string;
  file?: string;
  line?: number;
  recommendation?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSeverity(value: unknown): value is SeverityName {
  return typeof value === "string" && (SEVERITY_ORDER as readonly string[]).includes(value);
}

function toFlatIssue(module: string, raw: unknown): FlatIssue | null {
  if (!isRecord(raw) || !isSeverity(raw["severity"])) return null;
  const issue: FlatIssue = {
    module,
    severity: raw["severity"],
    title: typeof raw["title"] === "string" ? raw["title"] : "Issue",
    message: typeof raw["message"] === "string" ? raw["message"] : "",
  };
  const location = raw["location"];
  if (isRecord(location)) {
    if (typeof location["file"] === "string") issue.file = location["file"];
    if (typeof location["line"] === "number") issue.line = location["line"];
  }
  if (typeof raw["recommendation"] === "string" && raw["recommendation"] !== "") issue.recommendation = raw["recommendation"];
  return issue;
}

/** Every issue in the report, most severe first, then by module (stable otherwise). */
export function collectIssues(report: AuditReport): FlatIssue[] {
  const flat: FlatIssue[] = [];
  for (const [module, data] of Object.entries(report.modules)) {
    if (!isRecord(data) || !Array.isArray(data["issues"])) continue;
    for (const raw of data["issues"]) {
      const issue = toFlatIssue(module, raw);
      if (issue) flat.push(issue);
    }
  }
  return flat
    .map((issue, index) => ({ issue, index }))
    .sort(
      (a, b) =>
        SEVERITY_ORDER.indexOf(a.issue.severity) - SEVERITY_ORDER.indexOf(b.issue.severity) ||
        a.issue.module.localeCompare(b.issue.module) ||
        a.index - b.index
    )
    .map(({ issue }) => issue);
}

export interface FixGroup {
  recommendation: string;
  severity: SeverityName;
  count: number;
  modules: string[];
}

/** Recommendations de-duplicated and ranked: most severe first, then most frequent. */
export function groupFixes(issues: readonly FlatIssue[]): FixGroup[] {
  const groups = new Map<string, FixGroup>();
  for (const issue of issues) {
    if (issue.recommendation === undefined) continue;
    const existing = groups.get(issue.recommendation);
    if (!existing) {
      groups.set(issue.recommendation, { recommendation: issue.recommendation, severity: issue.severity, count: 1, modules: [issue.module] });
      continue;
    }
    existing.count += 1;
    if (SEVERITY_ORDER.indexOf(issue.severity) < SEVERITY_ORDER.indexOf(existing.severity)) existing.severity = issue.severity;
    if (!existing.modules.includes(issue.module)) existing.modules.push(issue.module);
  }
  return [...groups.values()].sort(
    (a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) || b.count - a.count
  );
}

/**
 * "file:line" for an issue, or an empty string. A file the title already names is not repeated
 * (e.g. "Configuration Issue: .eslintignore") unless there is a line to point at.
 */
export function formatLocation(issue: Pick<FlatIssue, "file" | "line"> & { title?: string }): string {
  if (issue.file === undefined) return "";
  if (issue.line === undefined && issue.title?.includes(issue.file)) return "";
  return issue.line === undefined ? issue.file : `${issue.file}:${issue.line}`;
}

/**
 * A paste-ready prompt for an AI assistant (Claude, ChatGPT, an IDE agent) listing the findings,
 * most severe first, and pointing at `muraqib agent` for the structured report to re-check with.
 */
export function buildAssistantPrompt(report: AuditReport, limit = 15): string {
  const issues = collectIssues(report).filter((i) => i.severity !== "info");
  const shown = issues.slice(0, limit);
  const lines = shown.map((issue, n) => {
    const where = formatLocation(issue);
    const fix = issue.recommendation ? ` Suggested fix: ${issue.recommendation}.` : "";
    return `${n + 1}. [${issue.severity}] ${issue.title}${where ? ` (${where})` : ""} - ${issue.message}.${fix}`;
  });
  const more = issues.length > shown.length ? `\n(${issues.length - shown.length} more not listed.)` : "";
  return [
    `Muraqib audited ${report.projectRoot} and found ${issues.length} issue(s) to fix. Fix them in order of severity without changing unrelated code:`,
    "",
    ...lines,
    more,
    "",
    `When done, re-run \`npx muraqib agent --project ${report.projectRoot}\` and confirm the verdict is "pass".`,
  ]
    .filter((line, index, all) => !(line === "" && all[index - 1] === ""))
    .join("\n");
}
