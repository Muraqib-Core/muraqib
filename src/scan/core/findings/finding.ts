
import type { AuditIssue } from "../../../core/types.js";

export type FindingSeverity =
  | "critical"
  | "high"
  | "medium"
  | "low"
  | "info";

export type FindingCategory =
  | "security"
  | "configuration"
  | "validation"
  | "compatibility"
  | "reliability";

export type DependencyType =
  | "dependencies"
  | "devDependencies"
  | "peerDependencies"
  | "optionalDependencies";

export type FindingConfidence =
  | "confirmed"
  | "inferred"
  | "advisory";  

export interface OsvAdvisoryData {
  id: string;
  summary?: string | undefined;
  details?: string | undefined;
  ranges?: Array<{
    type: string;
    events?: Array<{ introduced?: string; fixed?: string }>;
  }> | undefined;
}

export interface DependencyProblemData {
  package: string;
  installedVersion: string;
  declaredVersion: string;
  dependencyType: DependencyType;
  advisoryCount: number;
  advisories: OsvAdvisoryData[];
  affectedRanges: string[];
  fixedVersions: string[];
  resolutionMetadata?: Record<string, unknown> | undefined;
}

export interface ImageProblemData {
  imageId: string;
  target: string;
  ecosystem: string;
  package: string;
  installedVersion: string;
  advisoryId: string;
  fixedVersion?: string;
  severitySource?: string;
  scannedAt: string;
}

/** What a scanner reports before it is normalised into a {@link ScanIssue}. */
export interface ScanIssueInput {
  id: string;

  title: string;
  message: string;

  severity: FindingSeverity;
  category: FindingCategory;

  source: string;
  confidence?: FindingConfidence | undefined;

  file?: string | undefined;
  line?: number | undefined;
  key?: string | undefined;

  evidence?: string | undefined;
  remediation?: string | undefined;

  dependencyProblem?: DependencyProblemData | undefined;
  imageProblem?: ImageProblemData | undefined;
}

/** An {@link AuditIssue} produced by the scan layer, always carrying its five-level `level`. */
export type ScanIssue = AuditIssue & {
  level: FindingSeverity;
  category: FindingCategory;
  source: string;
};

const SEVERITY_MAP: Record<FindingSeverity, AuditIssue["severity"]> = {
  critical: "critical",
  high: "error",
  medium: "warning",
  low: "info",
  info: "info",
};

/** Normalise a scanner's report into the unified issue model (`severity` is the guard-level view of `level`). */
export function createScanIssue(input: ScanIssueInput): ScanIssue {
  const issue: ScanIssue = {
    code: input.id,
    severity: SEVERITY_MAP[input.severity],
    level: input.severity,
    title: input.title,
    message: input.message,
    category: input.category,
    source: input.source,
    tags: [input.source, input.category, ...(input.confidence ? [input.confidence] : [])],
  };
  if (input.remediation) issue.recommendation = input.remediation;
  if (input.file) issue.location = { file: input.file, ...(input.line !== undefined ? { line: input.line } : {}) };
  if (input.confidence) issue.confidence = input.confidence;
  if (input.evidence) issue.evidence = input.evidence;
  if (input.key) issue.key = input.key;
  if (input.dependencyProblem) issue.dependencyProblem = input.dependencyProblem;
  if (input.imageProblem) issue.imageProblem = input.imageProblem;
  return issue;
}
