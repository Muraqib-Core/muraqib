
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

export interface Finding {
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
