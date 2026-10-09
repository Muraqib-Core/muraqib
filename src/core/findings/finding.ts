/**
 * Finding Module
 * Unified interface for audit findings across all modules
 */

export type FindingSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type FindingCategory =
  | 'security'
  | 'performance'
  | 'reliability'
  | 'maintainability'
  | 'compatibility'
  | 'configuration'
  | 'dependency'
  | 'docker'
  | 'validation'
  | 'other';

export type FindingStatus = 'open' | 'resolved' | 'ignored' | 'pending-review';

export interface FindingSource {
  module: string;
  version?: string;
  timestamp: number;
  environment?: string;
}

export interface FindingMetadata {
  tags?: string[];
  relatedIssues?: string[];
  references?: string[];
  affectedFiles?: string[];
  customData?: Record<string, unknown>;
}

export interface Finding {
  id: string;
  title: string;
  description: string;
  category: FindingCategory;
  severity: FindingSeverity;
  status: FindingStatus;
  source: FindingSource;
  recommendation?: string;
  metadata?: FindingMetadata;
  createdAt: number;
  updatedAt: number;
}

export interface FindingGroup {
  severity: FindingSeverity;
  count: number;
  findings: Finding[];
}

export interface FindingStats {
  total: number;
  bySeverity: Record<FindingSeverity, number>;
  byCategory: Record<FindingCategory, number>;
  byStatus: Record<FindingStatus, number>;
}

/**
 * Severity levels for prioritization
 */
export const SEVERITY_LEVELS: Record<FindingSeverity, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1,
};

/**
 * Create a new Finding with minimal required data
 */
export function createFinding(
  title: string,
  description: string,
  category: FindingCategory,
  severity: FindingSeverity,
  source: Omit<FindingSource, 'timestamp'>,
  options?: {
    status?: FindingStatus;
    recommendation?: string;
    metadata?: FindingMetadata;
  }
): Finding {
  const now = Date.now();
  const id = `finding_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

  return {
    id,
    title,
    description,
    category,
    severity,
    status: options?.status || 'open',
    source: { ...source, timestamp: now },
    recommendation: options?.recommendation,
    metadata: options?.metadata,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Create a Finding from an AuditIssue (for backward compatibility)
 */
export function findingFromAuditIssue(
  issue: {
    code: string;
    severity: 'critical' | 'error' | 'warning' | 'info';
    title: string;
    message: string;
    recommendation?: string;
  },
  module: string,
  category: FindingCategory = 'other'
): Finding {
  const severityMap = {
    critical: 'critical' as const,
    error: 'high' as const,
    warning: 'medium' as const,
    info: 'info' as const,
  };

  return createFinding(
    issue.title,
    issue.message,
    category,
    severityMap[issue.severity],
    { module },
    {
      recommendation: issue.recommendation,
      metadata: {
        tags: [issue.code],
      },
    }
  );
}

/**
 * Compare two findings for sorting
 */
export function compareFindingsBySeverity(a: Finding, b: Finding): number {
  const severityDiff = SEVERITY_LEVELS[b.severity] - SEVERITY_LEVELS[a.severity];
  if (severityDiff !== 0) return severityDiff;
  return b.createdAt - a.createdAt;
}

/**
 * Filter findings by severity
 */
export function filterBySeverity(
  findings: Finding[],
  severities: FindingSeverity[]
): Finding[] {
  return findings.filter(f => severities.includes(f.severity));
}

/**
 * Filter findings by category
 */
export function filterByCategory(
  findings: Finding[],
  categories: FindingCategory[]
): Finding[] {
  return findings.filter(f => categories.includes(f.category));
}

/**
 * Filter findings by status
 */
export function filterByStatus(
  findings: Finding[],
  statuses: FindingStatus[]
): Finding[] {
  return findings.filter(f => statuses.includes(f.status));
}

/**
 * Filter findings by module
 */
export function filterByModule(
  findings: Finding[],
  modules: string[]
): Finding[] {
  return findings.filter(f => modules.includes(f.source.module));
}
