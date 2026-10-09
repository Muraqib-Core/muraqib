import type { Finding } from "../findings/finding.js";

export type ApprovalDecision = "approved" | "rejected";
export type ResolutionDirection =
  | "upgrade"
  | "downgrade"
  | "coordinated-upgrade"
  | "coordinated-downgrade";
export type RiskLevel = "Low" | "Medium" | "High";
export type CompatibilityStatus = "Compatible" | "Unknown" | "Incompatible";

export interface PackageChange {
  packageName: string;
  currentVersion: string;
  targetVersion: string;
  direction: ResolutionDirection;
  reason?: string;
}

export interface ResolutionPlan {
  id: string;
  title: string;
  planName: string;
  reason: string;
  changes: PackageChange[];
  findingsResolved: Finding[];
  securityImpact: string;
  compatibility: CompatibilityStatus;
  risk: RiskLevel;
  affectedPackages: string[];
  explanation?: string;
  baseFingerprint?: string;
  limitations?: string[];
}

export type VerificationStatus =
  | "passed"
  | "failed"
  | "unavailable"
  | "skipped"
  | "timed-out"
  | "infrastructure-error";

export interface VerificationStepResult {
  step: "dependencies" | "typecheck" | "tests" | "securityScan" | "compatibilityScan";
  passed: boolean;
  status?: VerificationStatus;
  message?: string;
}

export interface ResolutionResult {
  applied: boolean;
  status: "applied" | "rejected" | "stale" | "failed";
  message: string;
  appliedChanges?: PackageChange[];
  verificationResults?: VerificationStepResult[];
  rolledBack?: boolean;
}
