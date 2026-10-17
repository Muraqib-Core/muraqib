/**
 * Markdown compliance report: the security scorecard plus the blocking findings behind it.
 *
 * The output is plain GitHub-flavoured Markdown, so it can be written to `$GITHUB_STEP_SUMMARY`,
 * committed, or pasted into a README (the first line is a badge). It is deterministic: it contains
 * no timestamps, durations or absolute paths.
 */
import {
  SCORE_SEVERITIES,
  SEVERITY_PENALTY,
  CRITICAL_SCORE_CAP,
  calculateScorecard,
  classifyIssue,
} from "../core/scorecard.js";
import type {
  ClassifiableIssue,
  DomainBreakdown,
  ScoreDomain,
  ScoreGrade,
  ScoreSeverity,
  Scorecard,
  ScorecardFinding,
} from "../core/scorecard.js";
import type { FindingCategory, FindingSeverity } from "../scan/core/findings/finding.js";
import type { AuditReport } from "./types.js";

/** A finding that lowers the score, with enough context to act on it. */
export interface ReportFinding extends ScorecardFinding {
  module: string;
  title: string;
  file?: string;
  line?: number;
}

/** Everything the Markdown report is rendered from. */
export interface ScorecardReportData {
  scorecard: Scorecard;
  findings: ReportFinding[];
  /** Modules that contributed to the score, in report order. */
  modules: string[];
}

/** Most findings listed in the "Blocking findings" section before it is truncated. */
const MAX_LISTED_FINDINGS = 20;

const SEVERITY_LABEL: Record<ScoreSeverity | "info", string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
  info: "Info",
};

/** Severities listed individually in the "Blocking findings" section. */
const BLOCKING_SEVERITIES: readonly ScoreSeverity[] = ["critical", "high"];

const DOMAIN_LABEL: Record<ScoreDomain, string> = {
  security: "Security",
  dependencies: "Dependencies",
  "code-quality": "Code Quality",
};

const GRADE_COLOR: Record<ScoreGrade, string> = {
  A: "brightgreen",
  B: "green",
  C: "yellowgreen",
  D: "yellow",
  F: "red",
};

const GUARD_SEVERITIES = ["critical", "error", "warning", "info"] as const;
const FINDING_SEVERITIES: readonly FindingSeverity[] = ["critical", "high", "medium", "low", "info"];
const FINDING_CATEGORIES: readonly FindingCategory[] = ["security", "configuration", "validation", "compatibility", "reliability"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Returns `value` when it is one of `allowed`, narrowing it to that union. */
function oneOf<T extends string>(allowed: readonly T[], value: unknown): T | undefined {
  return allowed.find((candidate) => candidate === value);
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** Reads a loosely typed issue; returns undefined when it has no usable severity. */
function readIssue(value: unknown, moduleName: string): { issue: ClassifiableIssue; title: string; file?: string; line?: number } | undefined {
  if (!isRecord(value)) return undefined;
  const severity = oneOf(GUARD_SEVERITIES, value["severity"]);
  if (severity === undefined) return undefined;
  const location = isRecord(value["location"]) ? value["location"] : {};
  const file = stringOrUndefined(location["file"]);
  const line = typeof location["line"] === "number" ? location["line"] : undefined;
  const tags = Array.isArray(value["tags"]) ? value["tags"].filter((tag): tag is string => typeof tag === "string") : [];
  return {
    issue: {
      severity,
      level: oneOf(FINDING_SEVERITIES, value["level"]),
      category: oneOf(FINDING_CATEGORIES, value["category"]),
      module: stringOrUndefined(value["module"]) ?? moduleName,
      tags,
      dependencyProblem: value["dependencyProblem"],
      imageProblem: value["imageProblem"],
    },
    title: stringOrUndefined(value["title"]) ?? stringOrUndefined(value["code"]) ?? "Untitled finding",
    ...(file !== undefined ? { file } : {}),
    ...(line !== undefined ? { line } : {}),
  };
}

/**
 * Extract and classify every finding in a CLI audit report.
 * Modules that are not audit results (for example the AI advisory text) are ignored.
 *
 * @param report - Report built by the CLI
 * @returns Classified findings in report order, plus the modules that were evaluated
 */
export function findingsFromReport(report: AuditReport): { findings: ReportFinding[]; modules: string[] } {
  const findings: ReportFinding[] = [];
  const modules: string[] = [];
  for (const [moduleName, data] of Object.entries(report.modules)) {
    if (!isRecord(data) || !Array.isArray(data["issues"])) continue;
    modules.push(moduleName);
    for (const raw of data["issues"]) {
      const read = readIssue(raw, moduleName);
      if (!read) continue;
      findings.push({
        ...classifyIssue(read.issue),
        module: read.issue.module ?? moduleName,
        title: read.title,
        ...(read.file !== undefined ? { file: read.file } : {}),
        ...(read.line !== undefined ? { line: read.line } : {}),
      });
    }
  }
  return { findings, modules };
}

/**
 * Build the scorecard and the data behind it from a CLI audit report.
 *
 * @param report - Report built by the CLI
 * @returns The scorecard, the classified findings and the evaluated modules
 */
export function scorecardFromReport(report: AuditReport): ScorecardReportData {
  const { findings, modules } = findingsFromReport(report);
  return { scorecard: calculateScorecard(findings), findings, modules };
}

/** Escapes text from untrusted findings so it cannot break a table or inject HTML. */
function escapeMarkdown(text: string): string {
  return text
    .replace(/[\r\n]+/g, " ")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/[|`*_[\]]/g, (char) => `\\${char}`)
    .trim();
}

/** Shields.io static badge for the overall score, suitable for a README. */
export function scoreBadge(scorecard: Pick<Scorecard, "score" | "grade">): string {
  return `![Security Score](https://img.shields.io/badge/security%20score-${scorecard.score}%2F100%20(${scorecard.grade})-${GRADE_COLOR[scorecard.grade]})`;
}

function severityTable(scorecard: Scorecard): string[] {
  return [
    "| Severity | Findings | Penalty |",
    "| --- | ---: | ---: |",
    ...scorecard.bySeverity.map(
      (row) => `| ${SEVERITY_LABEL[row.severity]} | ${row.count} | ${row.penalty === 0 ? "0" : `-${row.penalty}`} |`
    ),
  ];
}

function domainRow(row: DomainBreakdown): string {
  const counts = SCORE_SEVERITIES.map((severity) => row.counts[severity]).join(" / ");
  return `| ${DOMAIN_LABEL[row.domain]} | ${row.score}/100 | ${row.grade} | ${counts} |`;
}

function domainTable(scorecard: Scorecard): string[] {
  return [
    "| Domain | Score | Grade | Critical / High / Medium / Low |",
    "| --- | ---: | :---: | :---: |",
    ...scorecard.byDomain.map(domainRow),
  ];
}

function describeFinding(finding: ReportFinding): string {
  const where = finding.file === undefined ? "" : ` (\`${finding.file.replace(/`/g, "")}${finding.line === undefined ? "" : `:${finding.line}`}\`)`;
  return `- **${SEVERITY_LABEL[finding.severity]}** · ${escapeMarkdown(finding.title)}${where} · \`${finding.module.replace(/`/g, "")}\``;
}

function blockingFindings(findings: readonly ReportFinding[]): string[] {
  const blocking = BLOCKING_SEVERITIES.flatMap((severity) => findings.filter((finding) => finding.severity === severity));
  if (blocking.length === 0) return [];
  const listed = blocking.slice(0, MAX_LISTED_FINDINGS).map(describeFinding);
  const hidden = blocking.length - listed.length;
  return [
    "## Blocking findings",
    "",
    ...listed,
    ...(hidden > 0 ? ["", `_…and ${hidden} more critical/high finding(s) not shown._`] : []),
    "",
  ];
}

/**
 * Render the Markdown compliance report.
 *
 * @param data - Scorecard data from {@link scorecardFromReport}
 * @returns GitHub-flavoured Markdown ending in a newline
 */
export function renderScorecardMarkdown(data: ScorecardReportData): string {
  const { scorecard, findings, modules } = data;
  const lines: string[] = [
    scoreBadge(scorecard),
    "",
    "# Muraqib Security Scorecard",
    "",
    `**Overall score: ${scorecard.score}/100 (grade ${scorecard.grade})**`,
    "",
  ];

  if (scorecard.capped) {
    lines.push(
      `> ⚠️ **Score capped at ${CRITICAL_SCORE_CAP}.** At least one critical finding exists, so the score cannot exceed ${CRITICAL_SCORE_CAP} (it would be ${scorecard.uncappedScore} otherwise).`,
      ""
    );
  } else if (scorecard.findings === 0) {
    lines.push("> ✅ No scored findings.", "");
  }

  lines.push("## Severity breakdown", "", ...severityTable(scorecard), "");
  if (scorecard.info > 0) lines.push(`_${scorecard.info} informational finding(s) are not scored._`, "");
  lines.push("## Domain breakdown", "", ...domainTable(scorecard), "");
  lines.push(...blockingFindings(findings));

  lines.push(
    "## Method",
    "",
    `Starting from 100, each finding subtracts ${SCORE_SEVERITIES.map((s) => `${SEVERITY_PENALTY[s]} (${SEVERITY_LABEL[s].toLowerCase()})`).join(", ")}; the score never goes below 0. Any critical finding caps the score at ${CRITICAL_SCORE_CAP}. Informational findings are not scored.`,
    "",
    modules.length > 0
      ? `Modules evaluated: ${modules.map((name) => `\`${name.replace(/`/g, "")}\``).join(", ")}. Modules that were not run do not affect the score.`
      : "No audit modules were evaluated.",
    ""
  );
  return lines.join("\n");
}

/**
 * Format a CLI audit report as a Markdown compliance report.
 *
 * @param report - Report built by the CLI
 * @returns GitHub-flavoured Markdown
 */
export function formatMarkdown(report: AuditReport): string {
  return renderScorecardMarkdown(scorecardFromReport(report));
}
