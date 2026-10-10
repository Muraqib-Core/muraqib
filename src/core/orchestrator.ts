/**
 * AuditOrchestrator - Central orchestration engine for coordinating all audit guards
 * Executes guards in parallel, aggregates results, and provides unified reporting
 */

import { GuardFactory } from './guard-factory.js';
import type { AuditResult, AuditIssue, AuditContext, UnifiedAuditResult } from './types.js';
import type { GuardConfig } from './guard-factory.js';

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
      const results = await this.executeGuardsInParallel(guards);

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
          duration,
          timestamp: this.context.timestamp,
        },
      };
    } catch {
      const duration = Date.now() - startTime;

      return {
        success: false,
        results: [],
        issues: [],
        summary: {
          totalIssues: 0,
          critical: 0,
          errors: 1,
          warnings: 0,
          duration,
          timestamp: this.context.timestamp,
        },
      };
    }
  }

  /**
   * Execute all guards in parallel using Promise.allSettled
   */
  private async executeGuardsInParallel(guards: Array<{ run(): Promise<AuditResult>; constructor: { name: string } }>) {
    const promises = guards.map((guard) => guard.run());
    const results = await Promise.allSettled(promises);

    return results.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      } else {
        // Handle rejected promises
        const guard = guards[index];
        const moduleName = guard ? guard.constructor.name.replace('Guard', '').toLowerCase() : `guard-${index}`;
        return {
          status: 'error' as const,
          module: moduleName,
          issues: [
            {
              code: 'GUARD_REJECTED',
              severity: 'error' as const,
              title: 'Guard Execution Failed',
              message: result.reason instanceof Error ? result.reason.message : String(result.reason),
              recommendation: 'Check logs for details',
              tags: ['orchestrator', 'error'],
            },
          ],
          message: `Guard failed: ${result.reason}`,
          timestamp: Date.now(),
          duration: 0,
        };
      }
    });
  }

  /**
   * Aggregate results from all guards into a single issue list
   */
  private aggregateResults(results: AuditResult[]) {
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
        const aModule = a.tags?.[0] ?? '';
        const bModule = b.tags?.[0] ?? '';

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

    console.log('\n=== Muraqib Audit Summary ===');
    console.log(`✓ Timestamp: ${new Date(summary.timestamp).toISOString()}`);
    console.log(`✓ Duration: ${this.formatDuration(summary.duration)}`);
    console.log(`✓ Total Issues: ${summary.totalIssues}`);
    console.log(`  🔴 Critical: ${summary.critical}`);
    console.log(`  ⚠️  Errors: ${summary.errors}`);
    console.log(`  ⚡ Warnings: ${summary.warnings}`);

    if (summary.totalIssues === 0) {
      console.log('\n✅ All audits passed!');
    } else {
      console.log(`\n📋 Found ${summary.totalIssues} issue(s) to address.`);
    }

    console.log('============================\n');
  }

  /**
   * Utility: format duration for display
   */
  private formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
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
      const module = issue.tags?.[0] ?? 'unknown';
      if (!grouped.has(module)) {
        grouped.set(module, []);
      }
      grouped.get(module)!.push(issue);
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
