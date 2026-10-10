/**
 * Muraqib Core - Unified Types
 * Combines Aya's audit modules with Jenan's flexibility
 */

import { z } from "zod";
import type {
  DependencyProblemData,
  FindingCategory as ScanCategory,
  FindingConfidence,
  FindingSeverity as ScanLevel,
  ImageProblemData,
} from "../scan/core/findings/finding.js";


/**
 * StandardSchemaV1 - Universal schema compatibility
 */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly "~standard": {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (value: unknown) => Promise<
      | { value: Output; issues?: never }
      | {
          issues: Array<{ message: string; path?: Array<string | number> }>;
          value?: never;
        }
    >;
  };
}

export type GuardSchema = StandardSchemaV1<unknown, unknown> | Record<string, z.ZodTypeAny>;

export interface GuardOptions {
  runtimeEnv: Record<string, string | undefined>;
  runtimeEnvStrict?: Record<string, string>;
  isServer?: boolean;
  emptyStringAsUndefined?: boolean;
  clientPrefix?: string;
  extends?: string[];
  engine?: "zod" | "valibot" | "arktype" | "custom";
  projectRoot?: string;
}

export interface AuditIssue {
  code: string;
  severity: "critical" | "error" | "warning" | "info";
  title: string;
  message: string;
  location?: {
    file?: string;
    line?: number;
    column?: number;
  };
  recommendation?: string;
  tags: string[];
  /** Five-level severity from the scan layer; `severity` is its guard-level view. */
  level?: ScanLevel;
  category?: ScanCategory;
  source?: string;
  /** Scan-layer detail carried through so an issue keeps the full scanner report. */
  confidence?: FindingConfidence;
  evidence?: string;
  key?: string;
  dependencyProblem?: DependencyProblemData;
  imageProblem?: ImageProblemData;
}

export interface AuditResult {
  status: "ok" | "issues" | "warning" | "error";
  module: string;
  issues: AuditIssue[];
  message: string;
  timestamp: number;
  duration: number;
}


export interface AuditContext {
  projectRoot: string;
  timestamp: number;
  environment: "development" | "production" | "ci";
  nodeVersion: string;
  npmVersion: string;
  gitBranch?: string;
  gitCommit?: string;
}

export interface AIInsight {
  issue: AuditIssue;
  recommendation: string;
  explanation: string;
  confidence: number;
  relatedPatterns?: string[];
}

export interface SecretDetectionResult {
  found: boolean;
  secrets: Array<{
    type: string;
    line: number;
    severity: "critical" | "high";
    details: string;
  }>;
}

export interface UnifiedAuditResult {
  success: boolean;
  results: AuditResult[];
  /** Every guard issue, sorted per the orchestrator configuration. */
  issues: AuditIssue[];
  aiInsights?: AIInsight[];
  secretsFound?: SecretDetectionResult;
  summary: {
    totalIssues: number;
    critical: number;
    errors: number;
    warnings: number;
    duration: number;
    timestamp: number;
  };
}
