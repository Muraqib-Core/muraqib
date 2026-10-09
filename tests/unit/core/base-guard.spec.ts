import { describe, it, expect, vi } from 'vitest';
import { BaseGuard } from '../../../src/core/base-guard.js';
import type { AuditResult } from '../../../src/core/types.js';

// Test implementation of BaseGuard
class TestGuard extends BaseGuard {
  async execute(): Promise<AuditResult> {
    return this.ok('Test passed');
  }
}

class ErrorGuard extends BaseGuard {
  async execute(): Promise<AuditResult> {
    throw new Error('Test error');
  }
}

class IssuesGuard extends BaseGuard {
  async execute(): Promise<AuditResult> {
    return this.issues(
      [
        this.createIssue(
          'TEST_ERROR',
          'error',
          'Test Error',
          'This is a test error'
        ),
        this.createIssue(
          'TEST_WARNING',
          'warning',
          'Test Warning',
          'This is a test warning'
        ),
      ],
      'Found test issues'
    );
  }
}

describe('BaseGuard', () => {
  describe('run()', () => {
    it('should execute and measure timing', async () => {
      const guard = new TestGuard('test-guard');
      const result = await guard.run();

      expect(result.status).toBe('ok');
      expect(result.module).toBe('test-guard');
      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(result.timestamp).toBeGreaterThan(0);
    });

    it('should handle errors gracefully', async () => {
      const guard = new ErrorGuard('error-guard');
      const result = await guard.run();

      expect(result.status).toBe('error');
      expect(result.issues.length).toBe(1);
      expect(result.issues[0].code).toBe('GUARD_ERROR');
      expect(result.issues[0].severity).toBe('error');
      expect(result.message).toContain('Test error');
    });

    it('should return consistent timestamp across multiple runs', async () => {
      const guard = new TestGuard('test-guard');
      const result1 = await guard.run();
      const result2 = await guard.run();

      expect(result1.status).toBe('ok');
      expect(result2.status).toBe('ok');
      expect(result2.timestamp).toBeGreaterThanOrEqual(result1.timestamp);
    });
  });

  describe('createIssue()', () => {
    it('should create a well-formed issue', async () => {
      const guard = new TestGuard('test-guard');
      const issue = guard['createIssue'](
        'TEST_CODE',
        'error',
        'Test Title',
        'Test message',
        { file: 'test.ts', line: 10 },
        'Fix this',
        ['test', 'tag']
      );

      expect(issue.code).toBe('TEST_CODE');
      expect(issue.severity).toBe('error');
      expect(issue.title).toBe('Test Title');
      expect(issue.message).toBe('Test message');
      expect(issue.location?.file).toBe('test.ts');
      expect(issue.location?.line).toBe(10);
      expect(issue.recommendation).toBe('Fix this');
      expect(issue.tags).toContain('test');
      expect(issue.tags).toContain('tag');
    });

    it('should handle missing optional fields', () => {
      const guard = new TestGuard('test-guard');
      const issue = guard['createIssue'](
        'MINIMAL',
        'info',
        'Minimal Issue',
        'Just message'
      );

      expect(issue.recommendation).toBeUndefined();
      expect(issue.location).toBeUndefined();
      expect(issue.tags).toEqual([]);
    });
  });

  describe('createResult()', () => {
    it('should create a valid AuditResult', async () => {
      const guard = new TestGuard('test-guard');
      const result = await guard.run();

      expect(result).toHaveProperty('status');
      expect(result).toHaveProperty('module', 'test-guard');
      expect(result).toHaveProperty('issues');
      expect(result).toHaveProperty('message');
      expect(result).toHaveProperty('timestamp');
      expect(result).toHaveProperty('duration');
    });
  });

  describe('ok()', () => {
    it('should return success status with empty issues', async () => {
      const guard = new TestGuard('test-guard');
      const result = await guard.run();

      expect(result.status).toBe('ok');
      expect(result.issues).toHaveLength(0);
      expect(result.message).toBe('Test passed');
    });
  });

  describe('issues()', () => {
    it('should determine status based on issue severity', async () => {
      const guard = new IssuesGuard('issues-guard');
      const result = await guard.run();

      // With error + warning → status is 'issues' (not error)
      expect(result.status).toBe('issues');
      expect(result.issues).toHaveLength(2);
      expect(result.message).toContain('Found test issues');
    });

    it('should set status to warning if only warnings', () => {
      const guard = new TestGuard('warning-guard');
      const issues = [
        guard['createIssue']('WARN1', 'warning', 'Warning 1', 'msg'),
        guard['createIssue']('WARN2', 'warning', 'Warning 2', 'msg'),
      ];
      const result = guard['issues'](issues);

      expect(result.status).toBe('warning');
      expect(result.issues).toHaveLength(2);
    });

    it('should set status to issues if only info', () => {
      const guard = new TestGuard('info-guard');
      const issues = [
        guard['createIssue']('INFO1', 'info', 'Info 1', 'msg'),
      ];
      const result = guard['issues'](issues);

      expect(result.status).toBe('warning');
      expect(result.issues).toHaveLength(1);
    });
  });

  describe('toFindings()', () => {
    it('should convert AuditResult issues to findings', async () => {
      const guard = new IssuesGuard('issues-guard');
      const auditResult = await guard.run();
      const findings = guard['toFindings'](auditResult);

      expect(findings).toHaveLength(2);
      expect(findings[0]).toHaveProperty('id');
      expect(findings[0]).toHaveProperty('severity');
      expect(findings[0]).toHaveProperty('category');
      expect(findings[0]).toHaveProperty('title');
      expect(findings[0]).toHaveProperty('description');
      expect(findings[0]).toHaveProperty('status');
      expect(findings[0]).toHaveProperty('source');
      expect(findings[0].metadata?.tags).toContain('issues-guard');
    });
  });

  describe('logging methods', () => {
    it('should call console methods appropriately', () => {
      const guard = new TestGuard('log-guard');
      const logSpy = vi.spyOn(console, 'log');
      const warnSpy = vi.spyOn(console, 'warn');
      const errorSpy = vi.spyOn(console, 'error');

      guard['log']('test log');
      expect(logSpy).toHaveBeenCalledWith('[log-guard] test log');

      guard['warn']('test warn');
      expect(warnSpy).toHaveBeenCalledWith('[log-guard] ⚠️  test warn');

      guard['error']('test error');
      expect(errorSpy).toHaveBeenCalledWith('[log-guard] ❌ test error');

      logSpy.mockRestore();
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    });
  });

  describe('utility methods', () => {
    it('should format duration correctly', () => {
      const guard = new TestGuard('util-guard');

      expect(guard['formatDuration'](500)).toBe('500ms');
      expect(guard['formatDuration'](1000)).toBe('1.00s');
      expect(guard['formatDuration'](5500)).toBe('5.50s');
    });

    it('should format bytes correctly', () => {
      const guard = new TestGuard('util-guard');

      expect(guard['formatBytes'](0)).toBe('0 B');
      expect(guard['formatBytes'](1024)).toBe('1.00 KB');
      expect(guard['formatBytes'](1048576)).toBe('1.00 MB');
      expect(guard['formatBytes'](1073741824)).toBe('1.00 GB');
    });

    it('should parse JSON safely', () => {
      const guard = new TestGuard('json-guard');
      const fallback = { default: true };

      const valid = guard['parseJSON']('{"test": true}', fallback);
      expect(valid).toEqual({ test: true });

      const invalid = guard['parseJSON']('invalid json', fallback);
      expect(invalid).toEqual(fallback);
    });
  });

  describe('integration', () => {
    it('should work with multiple guards in sequence', async () => {
      const guards = [
        new TestGuard('guard-1'),
        new IssuesGuard('guard-2'),
        new TestGuard('guard-3'),
      ];

      const results = await Promise.all(
        guards.map((g) => g.run())
      );

      expect(results).toHaveLength(3);
      expect(results[0].status).toBe('ok');
      expect(results[1].status).toBe('issues'); // error + warning → 'issues'
      expect(results[2].status).toBe('ok');
    });
  });
});
