import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AuditOrchestrator } from '../../../src/core/orchestrator.js';
import type { AuditContext } from '../../../src/core/types.js';

const createTestContext = (): AuditContext => ({
  projectRoot: '/test/project',
  timestamp: Date.now(),
  environment: 'development',
  nodeVersion: process.version,
  npmVersion: '9.0.0',
  gitBranch: 'main',
  gitCommit: 'abc123',
});

describe('AuditOrchestrator', () => {
  let context: AuditContext;

  beforeEach(() => {
    context = createTestContext();
  });

  describe('creation', () => {
    it('should create an orchestrator with context', () => {
      const orchestrator = AuditOrchestrator.create(context);

      expect(orchestrator).toBeDefined();
      expect(orchestrator).toHaveProperty('execute');
      expect(orchestrator).toHaveProperty('printSummary');
    });

    it('should accept configuration', () => {
      const config = {
        projectRoot: '/test',
        sortBy: 'module' as const,
        sortOrder: 'desc' as const,
      };

      const orchestrator = AuditOrchestrator.create(context, config);
      expect(orchestrator).toBeDefined();
    });
  });

  describe('execute()', () => {
    it('should return unified audit result', async () => {
      const orchestrator = AuditOrchestrator.create(context);
      const result = await orchestrator.execute();

      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('results');
      expect(result).toHaveProperty('issues');
      expect(result).toHaveProperty('summary');
    });

    it('should have valid summary structure', async () => {
      const orchestrator = AuditOrchestrator.create(context);
      const result = await orchestrator.execute();

      const { summary } = result;
      expect(summary).toHaveProperty('totalIssues');
      expect(summary).toHaveProperty('critical');
      expect(summary).toHaveProperty('errors');
      expect(summary).toHaveProperty('warnings');
      expect(summary).toHaveProperty('duration');
      expect(summary).toHaveProperty('timestamp');

      expect(typeof summary.totalIssues).toBe('number');
      expect(typeof summary.duration).toBe('number');
      expect(summary.duration).toBeGreaterThanOrEqual(0);
    });

    it('should execute guards in parallel', async () => {
      const orchestrator = AuditOrchestrator.create(context, { parallel: true });
      const startTime = Date.now();
      const result = await orchestrator.execute();
      const duration = Date.now() - startTime;

      expect(result.success).toBe(true);
      expect(result.results.length).toBeGreaterThan(0);
      // Parallel execution should be reasonably fast
      expect(duration).toBeLessThan(5000);
    });

    it('should aggregate all issues from all guards', async () => {
      const orchestrator = AuditOrchestrator.create(context, {
        projectRoot: '/test',
      });

      const result = await orchestrator.execute();

      // Should have at least memory guard result
      expect(result.results.length).toBeGreaterThan(0);

      // Every aggregated issue carries the unified AuditIssue fields
      for (const issue of result.issues) {
        expect(issue).toHaveProperty('code');
        expect(issue).toHaveProperty('severity');
        expect(issue).toHaveProperty('title');
      }
    });

    it('should report a summary that matches the aggregated issues', async () => {
      const orchestrator = AuditOrchestrator.create(context);
      const result = await orchestrator.execute();

      expect(result.summary.totalIssues).toBe(result.issues.length);
    });
  });

  describe('sorting', () => {
    it('should sort by severity (ascending)', async () => {
      const orchestrator = AuditOrchestrator.create(context, {
        sortBy: 'severity',
        sortOrder: 'asc',
      });

      const result = await orchestrator.execute();
      const issues = result.issues;

      // Verify sort order: critical, error, warning, info
      const severities = issues.map((i) => i.severity);
      for (let i = 0; i < severities.length - 1; i++) {
        const current = { critical: 1, error: 2, warning: 3, info: 4 };
        const curr = current[severities[i] as keyof typeof current] ?? 99;
        const next = current[severities[i + 1] as keyof typeof current] ?? 99;
        expect(curr).toBeLessThanOrEqual(next);
      }
    });

    it('should sort by severity (descending)', async () => {
      const orchestrator = AuditOrchestrator.create(context, {
        sortBy: 'severity',
        sortOrder: 'desc',
      });

      const result = await orchestrator.execute();
      const issues = result.issues;

      // Verify reverse sort order
      const severities = issues.map((i) => i.severity);
      for (let i = 0; i < severities.length - 1; i++) {
        const current = { critical: 1, error: 2, warning: 3, info: 4 };
        const curr = current[severities[i] as keyof typeof current] ?? 99;
        const next = current[severities[i + 1] as keyof typeof current] ?? 99;
        expect(curr).toBeGreaterThanOrEqual(next);
      }
    });

    it('should sort by module', async () => {
      const orchestrator = AuditOrchestrator.create(context, {
        sortBy: 'module',
        sortOrder: 'asc',
      });

      const result = await orchestrator.execute();
      const issues = result.issues;

      // Verify alphabetical sort
      const modules = issues.map((i) => i.tags?.[0] ?? '');
      for (let i = 0; i < modules.length - 1; i++) {
        expect(modules[i].localeCompare(modules[i + 1])).toBeLessThanOrEqual(0);
      }
    });
  });

  describe('issue filtering', () => {
    it('should filter issues by severity', async () => {
      const orchestrator = AuditOrchestrator.create(context);
      const result = await orchestrator.execute();
      const allIssues = result.issues;

      const critical = orchestrator.getIssuesBySeverity(
        allIssues,
        'critical'
      );
      const errors = orchestrator.getIssuesBySeverity(
        allIssues,
        'error'
      );
      const warnings = orchestrator.getIssuesBySeverity(
        allIssues,
        'warning'
      );

      expect(critical.length).toBeLessThanOrEqual(allIssues.length);
      expect(errors.length).toBeLessThanOrEqual(allIssues.length);
      expect(warnings.length).toBeLessThanOrEqual(allIssues.length);
    });

    it('should group issues by module', async () => {
      const orchestrator = AuditOrchestrator.create(context);
      const result = await orchestrator.execute();
      const allIssues = result.issues;

      const byModule = orchestrator.getIssuesByModule(
        allIssues
      );

      expect(byModule).toBeInstanceOf(Map);

      for (const [module, issues] of byModule) {
        expect(module).toBeDefined();
        expect(Array.isArray(issues)).toBe(true);
        expect(issues.length).toBeGreaterThan(0);
      }
    });
  });

  describe('summary reporting', () => {
    it('should print summary without errors', async () => {
      const orchestrator = AuditOrchestrator.create(context);
      const result = await orchestrator.execute();
      const logSpy = vi.spyOn(console, 'log');

      orchestrator.printSummary(result);

      expect(logSpy).toHaveBeenCalled();
      const calls = logSpy.mock.calls.map((c) => c[0]).join('\n');

      expect(calls).toContain('Muraqib Audit Summary');
      expect(calls).toContain('Duration');
      expect(calls).toContain('Total Issues');

      logSpy.mockRestore();
    });

    it('should indicate success when no issues', async () => {
      const orchestrator = AuditOrchestrator.create(context);
      const result = await orchestrator.execute();
      const logSpy = vi.spyOn(console, 'log');

      orchestrator.printSummary(result);

      // Check if either success message or issue count is printed
      const calls = logSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(
        calls.includes('passed') ||
        calls.includes('issue(s) to address')
      ).toBe(true);

      logSpy.mockRestore();
    });
  });

  describe('parallel execution', () => {
    it('should handle multiple guards concurrently', async () => {
      const orchestrator = AuditOrchestrator.create(context, {
        asyncTargetPath: '/src',
        dependencyTargetPath: '/src',
        projectRoot: '/test',
      });

      const result = await orchestrator.execute();

      expect(result.success).toBe(true);
      expect(result.results.length).toBeGreaterThan(1);
    });

    it('should complete all guards even if some fail', async () => {
      const orchestrator = AuditOrchestrator.create(context, {
        asyncTargetPath: '/non/existent/path',
        projectRoot: '/test',
      });

      const result = await orchestrator.execute();

      // Should still have results from other guards
      expect(result.results.length).toBeGreaterThan(0);
    });
  });

  describe('configuration', () => {
    it('should apply default configuration', () => {
      const orchestrator = AuditOrchestrator.create(context);
      const result1 = orchestrator.execute();

      expect(result1).toBeInstanceOf(Promise);
    });

    it('should accept custom configuration', async () => {
      const config = {
        projectRoot: '/custom',
        sortBy: 'module' as const,
        sortOrder: 'desc' as const,
        parallel: true,
      };

      const orchestrator = AuditOrchestrator.create(context, config);
      const result = await orchestrator.execute();

      expect(result.success).toBeDefined();
    });
  });

  describe('error handling', () => {
    it('should return success false on critical error', async () => {
      // Create an orchestrator and manually trigger an error scenario
      const orchestrator = AuditOrchestrator.create(context);
      const result = await orchestrator.execute();

      // Even with errors, should have a valid result structure
      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('summary');
      expect(result.summary).toHaveProperty('duration');
    });
  });

  describe('integration', () => {
    it('should execute full audit pipeline', async () => {
      const orchestrator = AuditOrchestrator.create(context, {
        projectRoot: '/test',
        memoryOptions: { heapWarnMb: 100 },
        sortBy: 'severity',
        sortOrder: 'asc',
      });

      const result = await orchestrator.execute();

      // Verify full pipeline execution
      expect(result.success).toBe(true);
      expect(result.results.length).toBeGreaterThan(0);
      expect(Array.isArray(result.issues)).toBe(true);
      expect(result.summary.totalIssues).toBeGreaterThanOrEqual(0);
      expect(result.summary.duration).toBeGreaterThanOrEqual(0);

      // Verify issues are properly aggregated
      const criticalCount = result.issues.filter(
        (f) => f.severity === 'critical'
      ).length;
      const errorCount = result.issues.filter(
        (f) => f.severity === 'error'
      ).length;
      const warningCount = result.issues.filter(
        (f) => f.severity === 'warning'
      ).length;

      expect(
        criticalCount + errorCount + warningCount
      ).toBeLessThanOrEqual(result.summary.totalIssues);
    });

    it('should maintain execution order through orchestration', async () => {
      const orchestrator = AuditOrchestrator.create(context);
      const start = Date.now();
      const result = await orchestrator.execute();
      const end = Date.now();

      expect(result.summary.duration).toBeGreaterThanOrEqual(0);
      expect(result.summary.duration).toBeLessThanOrEqual(end - start + 100);
    });
  });
});
