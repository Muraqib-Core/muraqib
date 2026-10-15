/**
 * AuditOrchestrator - Central orchestration engine for coordinating all audit guards
 * Executes guards in parallel, aggregates results, and provides unified reporting
 */

import type { BaseGuard } from './base-guard.js';
import { GuardFactory } from './guard-factory.js';
import type { AuditResult, AuditIssue, AuditContext, UnifiedAuditResult } from './types.js';
import type { GuardConfig } from './guard-factory.js';
import * as logger from "../shared/logger.js";

export interface OrchestratorConfig extends GuardConfig {
  parallel?: boolean;
  sortBy?: 'severity' | 'module' | 'time';
  sortOrder?: 'asc' | 'desc';
}

const SEVERITY_LEVELS: Record<string, number> = {
  critical: 1,
  error: 2,
  warning: 3,
  info: 4,
};

/**
 * Audit orchestrator class.
 */
export class AuditOrchestrator {
  private context: AuditContext;
  private factory: GuardFactory;
  private config: OrchestratorConfig;

  constructor(context: AuditContext, config?: OrchestratorConfig) {
    this.context = context;
    this.config = {
      parallel: true,
      sortBy: 'severity',
      sortOrder: 'asc',
      ...config,
    };
    this.factory = GuardFactory.create(context);
  }

  /**
   * Run all guards and return unified audit results
   */
  async execute(): Promise<UnifiedAuditResult> {
    const startTime = Date.now();

    try {
      const guards = this.factory.createAllGuards(this.config);
      const results = this.config.parallel === false
        ? await this.executeGuardsSequentially(guards)
        : await this.executeGuardsInParallel(guards);

      const aggregated = this.aggregateResults(results);
      const sorted = this.sortIssues(aggregated.auditIssues);

      const duration = Date.now() - startTime;

      return {
        success: true,
        results,
        issues: sorted,
        summary: {
          totalIssues: sorted.length,
          critical: sorted.filter((i) => i.severity === 'critical').length,
          errors: sorted.filter((i) => i.severity === 'error').length,
          warnings: sorted.filter((i) => i.severity === 'warning').length,
          info: sorted.filter((i) => i.severity === 'info').length,
          duration,
          timestamp: this.context.timestamp,
        },
      };
    } catch (error) {
      const duration = Date.now() - startTime;

      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        results: [],
        issues: [],
        summary: {
          totalIssues: 0,
          critical: 0,
          errors: 1,
          warnings: 0,
          info: 0,
          duration,
          timestamp: this.context.timestamp,
        },
      };
    }
  }

  /**
   * Build the synthetic result for a guard whose run() rejected/threw.
   */
  private rejectedResult(guard: BaseGuard | undefined, index: number, reason: unknown): AuditResult {
    const moduleName = guard ? guard.getModule() : `guard-${index}`;
    const message = reason instanceof Error ? reason.message : String(reason);
    return {
      status: 'error',
      module: moduleName,
      issues: [
        {
          code: 'GUARD_REJECTED',
          severity: 'error',
          title: 'Guard Execution Failed',
          message,
          recommendation: 'Check logs for details',
          tags: ['orchestrator', 'error'],
          module: moduleName,
        },
      ],
      message: `Guard failed: ${message}`,
      timestamp: Date.now(),
      duration: 0,
    };
  }

  /**
   * Execute all guards in parallel using Promise.allSettled
   */
  private async executeGuardsInParallel(guards: BaseGuard[]): Promise<AuditResult[]> {
    const promises = guards.map(async (guard) => guard.run());
    const results = await Promise.allSettled(promises);

    return results.map((result, index) =>
      result.status === 'fulfilled' ? result.value : this.rejectedResult(guards[index], index, result.reason)
    );
  }

  /**
   * Execute guards one after another (used when `parallel` is false)
   */
  private async executeGuardsSequentially(guards: BaseGuard[]): Promise<AuditResult[]> {
    const results: AuditResult[] = [];
    for (const [index, guard] of guards.entries()) {
      try {
        results.push(await guard.run());
      } catch (reason) {
        results.push(this.rejectedResult(guard, index, reason));
      }
    }
    return results;
  }

  /**
   * Module name of an issue: explicit module, else first tag, else 'unknown'
   */
  private issueModule(issue: AuditIssue): string {
    return issue.module ?? issue.tags?.[0] ?? 'unknown';
  }

  /**
   * Aggregate results from all guards into a single issue list
   */
  private aggregateResults(results: AuditResult[]): { auditIssues: AuditIssue[]; moduleResults: AuditResult[] } {
    const allIssues: AuditIssue[] = [];

    for (const result of results) {
      allIssues.push(...result.issues);
    }

    return {
      auditIssues: allIssues,
      moduleResults: results,
    };
  }

  /**
   * Sort issues by severity and other criteria
   */
  private sortIssues(issues: AuditIssue[]): AuditIssue[] {
    const sorted = [...issues];

    if (this.config.sortBy === 'severity') {
      sorted.sort((a, b) => {
        const aLevel = SEVERITY_LEVELS[a.severity] ?? 99;
        const bLevel = SEVERITY_LEVELS[b.severity] ?? 99;

        if (this.config.sortOrder === 'asc') {
          return aLevel - bLevel;
        } else {
          return bLevel - aLevel;
        }
      });
    } else if (this.config.sortBy === 'module') {
      sorted.sort((a, b) => {
        const aModule = this.issueModule(a);
        const bModule = this.issueModule(b);

        if (this.config.sortOrder === 'asc') {
          return aModule.localeCompare(bModule);
        } else {
          return bModule.localeCompare(aModule);
        }
      });
    }

    return sorted;
  }

  /**
   * Print summary report to console
   */
  printSummary(result: UnifiedAuditResult): void {
    const { summary } = result;

    logger.log('\n=== Muraqib Audit Summary ===');
    logger.log(`✓ Timestamp: ${new Date(summary.timestamp).toISOString()}`);
    logger.log(`✓ Duration: ${this.formatDuration(summary.duration)}`);
    logger.log(`✓ Total Issues: ${summary.totalIssues}`);
    logger.log(`  🔴 Critical: ${summary.critical}`);
    logger.log(`  ⚠️  Errors: ${summary.errors}`);
    logger.log(`  ⚡ Warnings: ${summary.warnings}`);
    logger.log(`  ℹ️  Info: ${summary.info ?? 0}`);

    if (summary.totalIssues === 0) {
      logger.log('\n✅ All audits passed!');
    } else {
      logger.log(`\n📋 Found ${summary.totalIssues} issue(s) to address.`);
    }

    logger.log('============================\n');
  }

  /**
   * Utility: format duration for display
   */
  private formatDuration(ms: number): string {
    if (!Number.isFinite(ms) || ms <= 0) return '0ms';
    if (ms < 1000) return `${Math.round(ms)}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  }

  /**
   * Get issues filtered by severity
   */
  getIssuesBySeverity(issues: AuditIssue[], severity: string): AuditIssue[] {
    return issues.filter((i) => i.severity === severity);
  }

  /**
   * Get issues grouped by module
   */
  getIssuesByModule(issues: AuditIssue[]): Map<string, AuditIssue[]> {
    const grouped = new Map<string, AuditIssue[]>();

    for (const issue of issues) {
      const module = this.issueModule(issue);
      const bucket = grouped.get(module);
      if (bucket) bucket.push(issue);
      else grouped.set(module, [issue]);
    }

    return grouped;
  }

  /**
   * Static factory method
   */
  static create(context: AuditContext, config?: OrchestratorConfig): AuditOrchestrator {
    return new AuditOrchestrator(context, config);
  }
}
