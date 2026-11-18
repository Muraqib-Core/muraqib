/**
 * Security Scorecard - a pure, deterministic 0-100 score derived from audit findings.
 *
 * No I/O, clocks or randomness: the same findings always produce the same scorecard, so results
 * are safe to snapshot (golden tests), diff between CI runs and publish as badges.
 *
 * Scoring model
 * - Every scored finding subtracts a fixed, integer penalty from 100 (see {@link SEVERITY_PENALTY}).
 * - Hard cap: a single critical finding caps the overall score at {@link CRITICAL_SCORE_CAP}
 *   (59, a failing grade) no matter how few other findings exist.
 * - `info` findings are advisory: they are counted but never affect the score.
 * - Each domain is scored independently with the same rules; the overall score is computed from
 *   all findings together (not averaged), so the hard cap can never be diluted by a clean domain.
 */
import type { AuditIssue } from "./types.js";
import type { FindingCategory, FindingSeverity } from "../scan/core/findings/finding.js";

/** Severity levels that affect the score, most severe first. */
export const SCORE_SEVERITIES = ["critical", "high", "medium", "low"] as const;
export type ScoreSeverity = (typeof SCORE_SEVERITIES)[number];

/** Domains a finding is attributed to, in report order. */
export const SCORE_DOMAINS = ["security", "dependencies", "code-quality"] as const;
export type ScoreDomain = (typeof SCORE_DOMAINS)[number];

/** Letter grade for a score. */
export type ScoreGrade = "A" | "B" | "C" | "D" | "F";

/** Points removed from 100 per finding of each severity. */
export const SEVERITY_PENALTY: Readonly<Record<ScoreSeverity, number>> = {
  critical: 25,
  high: 10,
  medium: 4,
  low: 1,
};

/** Maximum overall (and per-domain) score while at least one critical finding exists. */
export const CRITICAL_SCORE_CAP = 59;

/** Minimum score for each grade; anything lower is an `F`. The critical cap always yields `F`. */
const GRADE_THRESHOLDS: ReadonlyArray<readonly [ScoreGrade, number]> = [
  ["A", 90],
  ["B", 80],
  ["C", 70],
  ["D", 60],
];

/** A finding reduced to what scoring needs. `severity: "info"` is counted but not scored. */
export interface ScorecardFinding {
  severity: ScoreSeverity | "info";
  domain: ScoreDomain;
}

/** Score for one slice of the findings (the whole project, or a single domain). */
export interface ScoreSlice {
  /** Final score, 0-100 (an integer). */
  score: number;
  grade: ScoreGrade;
  /** Score before the critical hard cap was applied. */
  uncappedScore: number;
  /** True when the critical hard cap lowered the score. */
  capped: boolean;
  /** Number of scored findings (critical + high + medium + low). */
  findings: number;
}

export interface SeverityBreakdown {
  severity: ScoreSeverity;
  count: number;
  /** Total points this severity removed before clamping to 0-100. */
  penalty: number;
}

export interface DomainBreakdown extends ScoreSlice {
  domain: ScoreDomain;
  /** Finding counts for this domain per severity. */
  counts: Readonly<Record<ScoreSeverity, number>>;
}

export interface Scorecard extends ScoreSlice {
  /** One entry per severity, most severe first (always all four). */
  bySeverity: SeverityBreakdown[];
  /** One entry per domain in {@link SCORE_DOMAINS} order (always all three). */
  byDomain: DomainBreakdown[];
  /** Advisory findings, counted but not scored. */
  info: number;
}

/** Letter grade for a 0-100 score. */
export function gradeFor(score: number): ScoreGrade {
  for (const [grade, minimum] of GRADE_THRESHOLDS) {
    if (score >= minimum) return grade;
  }
  return "F";
}

type SeverityCounts = Record<ScoreSeverity, number>;

function emptyCounts(): SeverityCounts {
  return { critical: 0, high: 0, medium: 0, low: 0 };
}

function countBySeverity(findings: readonly ScorecardFinding[]): SeverityCounts {
  const counts = emptyCounts();
  for (const finding of findings) {
    if (finding.severity !== "info") counts[finding.severity] += 1;
  }
  return counts;
}

function totalPenalty(counts: Readonly<SeverityCounts>): number {
  return SCORE_SEVERITIES.reduce((sum, severity) => sum + counts[severity] * SEVERITY_PENALTY[severity], 0);
}

function sliceFromCounts(counts: Readonly<SeverityCounts>): ScoreSlice {
  const uncappedScore = Math.max(0, 100 - totalPenalty(counts));
  const capped = counts.critical > 0 && uncappedScore > CRITICAL_SCORE_CAP;
  const score = capped ? CRITICAL_SCORE_CAP : uncappedScore;
  return {
    score,
    grade: gradeFor(score),
    uncappedScore,
    capped,
    findings: SCORE_SEVERITIES.reduce((sum, severity) => sum + counts[severity], 0),
  };
}

/**
 * Calculate the scorecard for a set of findings.
 *
 * @param findings - Findings to score; order does not matter and the input is never mutated
 * @returns The overall score with per-severity and per-domain breakdowns
 */
export function calculateScorecard(findings: readonly ScorecardFinding[]): Scorecard {
  const overall = countBySeverity(findings);
  return {
    ...sliceFromCounts(overall),
    bySeverity: SCORE_SEVERITIES.map((severity) => ({
      severity,
      count: overall[severity],
      penalty: overall[severity] * SEVERITY_PENALTY[severity],
    })),
    byDomain: SCORE_DOMAINS.map((domain) => {
      const counts = countBySeverity(findings.filter((finding) => finding.domain === domain));
      return { domain, counts, ...sliceFromCounts(counts) };
    }),
    info: findings.filter((finding) => finding.severity === "info").length,
  };
}

/**
 * The slice of an {@link AuditIssue} needed to classify it. Deliberately loose (advisory payloads
 * are `unknown`, `tags` optional) so reports from third-party guards can be classified safely.
 */
export interface ClassifiableIssue {
  severity: AuditIssue["severity"];
  level?: FindingSeverity | undefined;
  category?: FindingCategory | undefined;
  module?: string | undefined;
  tags?: readonly string[] | undefined;
  /** Presence marks a package advisory. */
  dependencyProblem?: unknown;
  /** Presence marks a container-image advisory. */
  imageProblem?: unknown;
}

/**
 * Map an issue to a score severity. The scan layer's five-level `level` wins when present;
 * otherwise the guard severity maps `error` to high and `warning` to medium.
 */
export function scoreSeverityOf(issue: Pick<ClassifiableIssue, "severity" | "level">): ScoreSeverity | "info" {
  switch (issue.level ?? issue.severity) {
    case "critical":
      return "critical";
    case "high":
    case "error":
      return "high";
    case "medium":
    case "warning":
      return "medium";
    case "low":
      return "low";
    case "info":
    default:
      return "info";
  }
}

/** Guard modules whose findings are about third-party packages and their compatibility. */
const DEPENDENCY_MODULES: ReadonlySet<string> = new Set(["dependency-guard", "compatibility-guard"]);
/** Guard modules whose findings are about security posture. */
const SECURITY_MODULES: ReadonlySet<string> = new Set(["security-guard"]);

/**
 * Attribute an issue to a domain. Precedence: package/image advisories, then the scan category,
 * then the producing module, then a `security`/`dependencies` tag; everything else is code quality.
 */
export function scoreDomainOf(issue: Omit<ClassifiableIssue, "severity" | "level">): ScoreDomain {
  if (issue.dependencyProblem !== undefined || issue.imageProblem !== undefined) return "dependencies";
  if (issue.category === "security") return "security";
  if (issue.category === "compatibility") return "dependencies";
  if (issue.module !== undefined && SECURITY_MODULES.has(issue.module)) return "security";
  if (issue.module !== undefined && DEPENDENCY_MODULES.has(issue.module)) return "dependencies";
  const tags = issue.tags ?? [];
  if (tags.includes("security")) return "security";
  if (tags.includes("dependencies")) return "dependencies";
  return "code-quality";
}

/**
 * Reduce an audit issue to a {@link ScorecardFinding}.
 *
 * @param issue - Issue produced by a guard or the scan layer
 * @returns Its score severity and domain
 */
export function classifyIssue(issue: ClassifiableIssue): ScorecardFinding {
  return { severity: scoreSeverityOf(issue), domain: scoreDomainOf(issue) };
}
