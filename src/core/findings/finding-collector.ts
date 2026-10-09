/**
 * Finding Collector System
 * Aggregates, filters, organizes, and reports audit findings by severity
 */

import type {
  Finding,
  FindingCategory,
  FindingSeverity,
  FindingStatus,
  FindingStats,
  FindingGroup,
} from './finding.js';
import {
  SEVERITY_LEVELS,
  compareFindingsBySeverity,
  filterBySeverity,
  filterByCategory,
  filterByStatus,
  filterByModule,
} from './finding.js';

export interface CollectorOptions {
  autoSortBySeverity?: boolean;
  autoGroupBySeverity?: boolean;
  maxFindingsPerReport?: number;
}

export interface FindingReport {
  timestamp: number;
  totalFindings: number;
  byCriticalSeverity: Finding[];
  byHighSeverity: Finding[];
  byMediumSeverity: Finding[];
  byLowSeverity: Finding[];
  byInfoSeverity: Finding[];
  stats: FindingStats;
  summary: string;
}

export interface FindingFilter {
  severities?: FindingSeverity[];
  categories?: FindingCategory[];
  statuses?: FindingStatus[];
  modules?: string[];
  minSeverityLevel?: number;
  createdAfter?: number;
  createdBefore?: number;
}

/**
 * Finding Collector - Unified system for aggregating and organizing audit findings
 */
export class FindingCollector {
  private findings: Map<string, Finding> = new Map();
  private options: Required<CollectorOptions>;

  constructor(options: CollectorOptions = {}) {
    this.options = {
      autoSortBySeverity: options.autoSortBySeverity ?? true,
      autoGroupBySeverity: options.autoGroupBySeverity ?? true,
      maxFindingsPerReport: options.maxFindingsPerReport ?? 1000,
    };
  }

  /**
   * Add a single finding to the collector
   */
  addFinding(finding: Finding): void {
    this.findings.set(finding.id, finding);
  }

  /**
   * Add multiple findings at once
   */
  addFindings(findings: Finding[]): void {
    findings.forEach(f => this.addFinding(f));
  }

  /**
   * Remove a finding by ID
   */
  removeFinding(id: string): boolean {
    return this.findings.delete(id);
  }

  /**
   * Update a finding's status
   */
  updateFindingStatus(id: string, status: FindingStatus): boolean {
    const finding = this.findings.get(id);
    if (!finding) return false;

    const updated = { ...finding, status, updatedAt: Date.now() };
    this.findings.set(id, updated);
    return true;
  }

  /**
   * Get a finding by ID
   */
  getFinding(id: string): Finding | undefined {
    return this.findings.get(id);
  }

  /**
   * Get all findings
   */
  getAllFindings(): Finding[] {
    return Array.from(this.findings.values());
  }

  /**
   * Get findings count
   */
  count(): number {
    return this.findings.size;
  }

  /**
   * Clear all findings
   */
  clear(): void {
    this.findings.clear();
  }

  /**
   * Filter findings by multiple criteria
   */
  filter(criteria: FindingFilter): Finding[] {
    let results = this.getAllFindings();

    if (criteria.severities && criteria.severities.length > 0) {
      results = filterBySeverity(results, criteria.severities);
    }

    if (criteria.categories && criteria.categories.length > 0) {
      results = filterByCategory(results, criteria.categories);
    }

    if (criteria.statuses && criteria.statuses.length > 0) {
      results = filterByStatus(results, criteria.statuses);
    }

    if (criteria.modules && criteria.modules.length > 0) {
      results = filterByModule(results, criteria.modules);
    }

    if (criteria.minSeverityLevel !== undefined) {
      results = results.filter(
        f => SEVERITY_LEVELS[f.severity] >= criteria.minSeverityLevel!
      );
    }

    if (criteria.createdAfter !== undefined) {
      results = results.filter(f => f.createdAt >= criteria.createdAfter!);
    }

    if (criteria.createdBefore !== undefined) {
      results = results.filter(f => f.createdAt <= criteria.createdBefore!);
    }

    return this.options.autoSortBySeverity
      ? results.sort(compareFindingsBySeverity)
      : results;
  }

  /**
   * Get findings grouped by severity
   */
  groupBySeverity(): Map<FindingSeverity, Finding[]> {
    const grouped = new Map<FindingSeverity, Finding[]>();
    const severities: FindingSeverity[] = ['critical', 'high', 'medium', 'low', 'info'];

    severities.forEach(severity => {
      grouped.set(severity, filterBySeverity(this.getAllFindings(), [severity]));
    });

    return grouped;
  }

  /**
   * Get findings grouped by category
   */
  groupByCategory(): Map<FindingCategory, Finding[]> {
    const grouped = new Map<FindingCategory, Finding[]>();
    const findings = this.getAllFindings();

    findings.forEach(finding => {
      const category = finding.category;
      if (!grouped.has(category)) {
        grouped.set(category, []);
      }
      grouped.get(category)!.push(finding);
    });

    return grouped;
  }

  /**
   * Get findings grouped by module
   */
  groupByModule(): Map<string, Finding[]> {
    const grouped = new Map<string, Finding[]>();
    const findings = this.getAllFindings();

    findings.forEach(finding => {
      const module = finding.source.module;
      if (!grouped.has(module)) {
        grouped.set(module, []);
      }
      grouped.get(module)!.push(finding);
    });

    return grouped;
  }

  /**
   * Get findings grouped by status
   */
  groupByStatus(): Map<FindingStatus, Finding[]> {
    const grouped = new Map<FindingStatus, Finding[]>();
    const statuses: FindingStatus[] = ['open', 'resolved', 'ignored', 'pending-review'];

    statuses.forEach(status => {
      grouped.set(status, filterByStatus(this.getAllFindings(), [status]));
    });

    return grouped;
  }

  /**
   * Calculate statistics for current findings
   */
  calculateStats(): FindingStats {
    const findings = this.getAllFindings();
    const stats: FindingStats = {
      total: findings.length,
      bySeverity: {
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        info: 0,
      },
      byCategory: {} as Record<FindingCategory, number>,
      byStatus: {
        open: 0,
        resolved: 0,
        ignored: 0,
        'pending-review': 0,
      },
    };

    findings.forEach(finding => {
      stats.bySeverity[finding.severity]++;
      stats.byStatus[finding.status]++;

      if (!stats.byCategory[finding.category]) {
        stats.byCategory[finding.category] = 0;
      }
      stats.byCategory[finding.category]++;
    });

    return stats;
  }

  /**
   * Generate a comprehensive audit report
   */
  generateReport(): FindingReport {
    const findings = this.getAllFindings().slice(0, this.options.maxFindingsPerReport);
    const sorted = findings.sort(compareFindingsBySeverity);
    const stats = this.calculateStats();

    const report: FindingReport = {
      timestamp: Date.now(),
      totalFindings: this.count(),
      byCriticalSeverity: filterBySeverity(sorted, ['critical']),
      byHighSeverity: filterBySeverity(sorted, ['high']),
      byMediumSeverity: filterBySeverity(sorted, ['medium']),
      byLowSeverity: filterBySeverity(sorted, ['low']),
      byInfoSeverity: filterBySeverity(sorted, ['info']),
      stats,
      summary: this.generateSummary(stats),
    };

    return report;
  }

  /**
   * Generate a text summary of findings
   */
  private generateSummary(stats: FindingStats): string {
    const lines = [
      `Audit Report Summary - ${new Date().toISOString()}`,
      `Total Findings: ${stats.total}`,
      '',
      'By Severity:',
      `  Critical: ${stats.bySeverity.critical}`,
      `  High:     ${stats.bySeverity.high}`,
      `  Medium:   ${stats.bySeverity.medium}`,
      `  Low:      ${stats.bySeverity.low}`,
      `  Info:     ${stats.bySeverity.info}`,
      '',
      'By Status:',
      `  Open:           ${stats.byStatus.open}`,
      `  Resolved:       ${stats.byStatus.resolved}`,
      `  Ignored:        ${stats.byStatus.ignored}`,
      `  Pending Review: ${stats.byStatus['pending-review']}`,
    ];

    return lines.join('\n');
  }

  /**
   * Export findings as structured data
   */
  export(): {
    findings: Finding[];
    stats: FindingStats;
    exportedAt: number;
  } {
    return {
      findings: this.getAllFindings(),
      stats: this.calculateStats(),
      exportedAt: Date.now(),
    };
  }

  /**
   * Import findings from structured data
   */
  import(data: { findings: Finding[] }): void {
    this.clear();
    this.addFindings(data.findings);
  }

  /**
   * Get findings by severity with details
   */
  getFindings(severity: FindingSeverity): Finding[] {
    return filterBySeverity(this.getAllFindings(), [severity]);
  }

  /**
   * Get highest severity findings (critical or high)
   */
  getCriticalFindings(): Finding[] {
    return filterBySeverity(this.getAllFindings(), ['critical', 'high']).sort(
      compareFindingsBySeverity
    );
  }

  /**
   * Get all open findings
   */
  getOpenFindings(): Finding[] {
    return filterByStatus(this.getAllFindings(), ['open']).sort(
      compareFindingsBySeverity
    );
  }

  /**
   * Get all resolved findings
   */
  getResolvedFindings(): Finding[] {
    return filterByStatus(this.getAllFindings(), ['resolved']);
  }

  /**
   * Check if collector has critical findings
   */
  hasCriticalFindings(): boolean {
    return this.getFindings('critical').length > 0;
  }

  /**
   * Get findings grouped by severity as FindingGroup array
   */
  getGroupedFindings(): FindingGroup[] {
    const severities: FindingSeverity[] = ['critical', 'high', 'medium', 'low', 'info'];
    return severities.map(severity => {
      const findings = this.getFindings(severity);
      return {
        severity,
        count: findings.length,
        findings,
      };
    });
  }

  /**
   * Merge another collector's findings into this one
   */
  merge(other: FindingCollector): void {
    other.getAllFindings().forEach(f => this.addFinding(f));
  }

  /**
   * Create a clone of this collector
   */
  clone(): FindingCollector {
    const cloned = new FindingCollector(this.options);
    cloned.import(this.export());
    return cloned;
  }
}

/**
 * Create a finding collector with default options
 */
export function createFindingCollector(
  options?: CollectorOptions
): FindingCollector {
  return new FindingCollector(options);
}
