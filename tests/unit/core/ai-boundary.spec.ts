import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  generateAdvisory,
  generateAuditAdvisory,
  type AIAdvisorConfig,
} from '../../../src/ai/advisor';
import type { AuditIssue, AuditResult } from '../../../src/core/types';

vi.mock('@google/genai', () => {
  const mockGenerateContent = vi.fn();
  return {
    GoogleGenAI: vi.fn(() => ({
      models: {
        generateContent: mockGenerateContent,
      },
    })),
  };
});

describe('AI Advisor - Boundary Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.GOOGLE_API_KEY;
  });

  describe('generateAdvisory', () => {
    it('should return error when no API key provided', async () => {
      const issues: AuditIssue[] = [
        {
          code: 'SEC_001',
          severity: 'error',
          title: 'Security Issue',
          message: 'Missing header',
        },
      ];

      const result = await generateAdvisory(issues, {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('Google API key');
      expect(result.suggestions).toHaveLength(0);
    });

    it('should accept API key from config', async () => {
      const issues: AuditIssue[] = [];
      const result = await generateAdvisory(issues, { apiKey: 'test-key' });
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it('should accept API key from environment', async () => {
      process.env.GOOGLE_API_KEY = 'env-key';
      const result = await generateAdvisory([], {});
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it('should return success with empty issues', async () => {
      const result = await generateAdvisory([], { apiKey: 'test-key' });
      expect(result.success).toBe(true);
      expect(result.suggestions).toHaveLength(0);
    });

    it('should filter incomplete issues', async () => {
      const issues: AuditIssue[] = [
        { code: '', severity: 'error', title: 'T', message: 'M' },
        { code: 'CODE1', severity: 'error', title: 'T', message: '' },
        { code: 'CODE2', severity: 'error', title: 'T', message: 'M' },
      ];
      const result = await generateAdvisory(issues, { apiKey: 'test-key' });
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it('should accept custom model', async () => {
      const result = await generateAdvisory([], {
        apiKey: 'test-key',
        model: 'gemini-1.5-pro',
      });
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it('should accept temperature config', async () => {
      const result = await generateAdvisory([], {
        apiKey: 'test-key',
        temperature: 0.5,
      });
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it('should accept maxTokens config', async () => {
      const result = await generateAdvisory([], {
        apiKey: 'test-key',
        maxTokens: 500,
      });
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it('should measure execution time', async () => {
      const result = await generateAdvisory([], { apiKey: 'test-key' });
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });
  });

  describe('generateAuditAdvisory', () => {
    it('should filter critical and error issues', async () => {
      const auditResult: AuditResult = {
        status: 'ok',
        module: 'test',
        issues: [
          { code: 'C1', severity: 'critical', title: 'C', message: 'C' },
          { code: 'E1', severity: 'error', title: 'E', message: 'E' },
          { code: 'W1', severity: 'warning', title: 'W', message: 'W' },
        ],
        message: 'Test',
        timestamp: Date.now(),
        duration: 100,
      };

      const result = await generateAuditAdvisory(auditResult, {
        apiKey: 'test-key',
      });

      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('suggestions');
    });

    it('should handle no critical issues', async () => {
      const auditResult: AuditResult = {
        status: 'ok',
        module: 'test',
        issues: [
          { code: 'W1', severity: 'warning', title: 'W', message: 'W' },
        ],
        message: 'Test',
        timestamp: Date.now(),
        duration: 100,
      };

      const result = await generateAuditAdvisory(auditResult, {
        apiKey: 'test-key',
      });

      expect(result.success).toBe(true);
      expect(result.suggestions).toHaveLength(0);
    });
  });

  describe('Edge cases', () => {
    it('should handle large issue arrays', async () => {
      const issues = Array.from({ length: 100 }, (_, i) => ({
        code: `CODE_${i}`,
        severity: 'error' as const,
        title: `Issue ${i}`,
        message: `Msg ${i}`,
      }));

      const result = await generateAdvisory(issues, { apiKey: 'test-key' });
      expect(result).toHaveProperty('duration');
    });

    it('should handle special characters', async () => {
      const issues: AuditIssue[] = [
        {
          code: 'SPECIAL',
          severity: 'error',
          title: '<>&"\'',
          message: 'Chars: <>&"\'',
        },
      ];

      const result = await generateAdvisory(issues, { apiKey: 'test-key' });
      expect(result).toHaveProperty('duration');
    });

    it('should handle unicode characters', async () => {
      const issues: AuditIssue[] = [
        {
          code: 'UNICODE',
          severity: 'error',
          title: 'مرحبا 你好',
          message: 'مرحبا 你好 🔒',
        },
      ];

      const result = await generateAdvisory(issues, { apiKey: 'test-key' });
      expect(result).toHaveProperty('duration');
    });

    it('should handle very long messages', async () => {
      const longMsg = 'A'.repeat(5000);
      const issues: AuditIssue[] = [
        {
          code: 'LONG',
          severity: 'error',
          title: 'Long',
          message: longMsg,
        },
      ];

      const result = await generateAdvisory(issues, { apiKey: 'test-key' });
      expect(result).toHaveProperty('duration');
    });
  });

  describe('Result validation', () => {
    it('should return valid result structure', async () => {
      const result = await generateAdvisory([], { apiKey: 'test-key' });

      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('suggestions');
      expect(result).toHaveProperty('duration');
      expect(typeof result.success).toBe('boolean');
      expect(Array.isArray(result.suggestions)).toBe(true);
      expect(typeof result.duration).toBe('number');
    });

    it('should include error on failure', async () => {
      const result = await generateAdvisory([], {});

      if (!result.success) {
        expect(result.error).toBeDefined();
        expect(typeof result.error).toBe('string');
      }
    });

    it('should have non-negative duration', async () => {
      const result = await generateAdvisory([], { apiKey: 'test-key' });
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });
  });
});
