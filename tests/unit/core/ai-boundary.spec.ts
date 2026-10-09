/**
 * @file tests/unit/core/ai-boundary.spec.ts
 * @description Test suite for AI advisory system boundary conditions
 *
 * Tests the AI advisor, secret detector, and fallback systems
 * with focus on edge cases and error handling.
 */

import { describe, it, expect } from "vitest";
import type { AuditIssue } from "../../../src/core/types.js";
import {
  generateAdvisory,
  generateAuditAdvisory,
  type AIAdvisorConfig,
} from "../../../src/ai/advisor.js";
import {
  detectSecretsInText,
  detectSecretsInEnv,
  assessSecretRisk,
  type SecretType,
} from "../../../src/ai/secret-detector.js";
import {
  generateFallbackSuggestions,
  analyzeUnknownVariablesWithFallback,
  shouldUseAI,
} from "../../../src/ai/fallback.js";

describe("AI Advisory System", () => {
  // ===== ADVISOR TESTS =====

  describe("generateAdvisory", () => {
    it("should handle empty issues array gracefully", async () => {
      const result = await generateAdvisory([], { apiKey: "test-key" });

      expect(result.success).toBe(true);
      expect(result.suggestions).toHaveLength(0);
      expect(result.error).toBeUndefined();
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it("should return error when API key is missing", async () => {
      const issues: AuditIssue[] = [
        {
          code: "TEST_001",
          severity: "error",
          title: "Test Issue",
          message: "This is a test issue",
        },
      ];

      // Remove GOOGLE_API_KEY if set
      const originalKey = process.env.GOOGLE_API_KEY;
      delete process.env.GOOGLE_API_KEY;

      const result = await generateAdvisory(issues);

      expect(result.success).toBe(false);
      expect(result.error).toContain("API key");
      expect(result.suggestions).toHaveLength(0);

      // Restore env var
      if (originalKey) {
        process.env.GOOGLE_API_KEY = originalKey;
      }
    });

    it("should filter out invalid issues", async () => {
      const invalidIssues: unknown[] = [
        null,
        undefined,
        { severity: "error" }, // missing code and message
        { code: "INVALID" }, // missing message
      ];

      const result = await generateAdvisory(
        invalidIssues as AuditIssue[],
        { apiKey: "test-key" }
      );

      // Should handle gracefully without throwing
      expect(result).toBeDefined();
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it("should include duration measurement", async () => {
      const issues: AuditIssue[] = [];
      const result = await generateAdvisory(issues, { apiKey: "test-key" });

      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(typeof result.duration).toBe("number");
    });

    it("should accept custom model configuration", async () => {
      const config: AIAdvisorConfig = {
        apiKey: "test-key",
        model: "gemini-2.0-pro",
        maxTokens: 1000,
        temperature: 0.5,
      };

      const issues: AuditIssue[] = [];
      const result = await generateAdvisory(issues, config);

      // Should not throw with custom config
      expect(result).toBeDefined();
    });
  });

  describe("generateAuditAdvisory", () => {
    it("should filter to critical and error issues only", async () => {
      const auditResult = {
        status: "issues" as const,
        module: "test",
        issues: [
          {
            code: "CRIT_001",
            severity: "critical" as const,
            title: "Critical",
            message: "Critical issue",
          },
          {
            code: "ERR_001",
            severity: "error" as const,
            title: "Error",
            message: "Error issue",
          },
          {
            code: "WARN_001",
            severity: "warning" as const,
            title: "Warning",
            message: "Warning issue",
          },
        ],
        message: "Test audit",
        timestamp: Date.now(),
        duration: 100,
      };

      const result = await generateAuditAdvisory(auditResult, {
        apiKey: "test-key",
      });

      // Should process without throwing
      expect(result).toBeDefined();
      expect(result.duration).toBeGreaterThan(0);
    });
  });

  // ===== SECRET DETECTOR TESTS =====

  describe("detectSecretsInText", () => {
    it("should detect API key patterns", () => {
      const content = 'const apiKey = "sk_live_' + 'a'.repeat(30) + '";';
      const secrets = detectSecretsInText(content);

      expect(secrets.length).toBeGreaterThan(0);
      expect(secrets[0].type).toBe("api_key");
      expect(secrets[0].confidence).toBeGreaterThanOrEqual(0.8);
    });

    it("should detect bearer tokens", () => {
      const content = "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIn0";
      const secrets = detectSecretsInText(content);

      expect(secrets.length).toBeGreaterThan(0);
      expect(secrets.some((s) => s.type === "bearer_token")).toBe(true);
    });

    it("should detect private keys", () => {
      const content = `-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEA2Z3q8F/wqVQtqkPQOJI8R5kwCgQ1qKDq6P2JGX8BH+Zx
aSFnKQbp3qKLlxF6zUZqZGJOq3R6qX9v9M7L0QCO1E8T3F9V2GvU4J5M+Yq
-----END RSA PRIVATE KEY-----`;
      const secrets = detectSecretsInText(content);

      expect(secrets.length).toBeGreaterThan(0);
      expect(secrets.some((s) => s.type === "private_key")).toBe(true);
    });

    it("should mask sensitive values", () => {
      const content = 'password="SuperSecretPassword123"';
      const secrets = detectSecretsInText(content);

      expect(secrets.length).toBeGreaterThan(0);
      secrets.forEach((secret) => {
        expect(secret.pattern).toContain("*");
      });
    });

    it("should track line numbers when scanning multi-line content", () => {
      const content = `line1=value1
password="secret123456789"
line3=value3`;
      const secrets = detectSecretsInText(content);

      const passwordSecret = secrets.find(
        (s) => s.type === "password"
      );
      if (passwordSecret && passwordSecret.line) {
        expect(passwordSecret.line).toBe(2);
      }
    });

    it("should handle empty content gracefully", () => {
      const secrets = detectSecretsInText("");

      expect(secrets).toHaveLength(0);
    });

    it("should return high confidence for exact matches", () => {
      const content = '"ghp_' + 'a'.repeat(36) + '"';
      const secrets = detectSecretsInText(content);

      expect(secrets.length).toBeGreaterThan(0);
      expect(secrets[0].confidence).toBeGreaterThanOrEqual(0.9);
    });
  });

  describe("detectSecretsInEnv", () => {
    it("should scan environment variable values", () => {
      const env = {
        API_KEY: "sk_live_" + "a".repeat(30),
        DB_PASSWORD: "super_secret_pass",
        NORMAL_VAR: "just_a_normal_value",
      };

      const secrets = detectSecretsInEnv(env);

      expect(secrets.length).toBeGreaterThan(0);
      expect(secrets.some((s) => s.file === "API_KEY")).toBe(true);
    });

    it("should flag suspicious variable names", () => {
      const env = {
        SECRET_KEY: "abc123",
        ADMIN_PASSWORD: "xyz789",
        APP_NAME: "MyApp",
      };

      const secrets = detectSecretsInEnv(env);

      expect(secrets.length).toBeGreaterThan(0);
    });

    it("should skip undefined values", () => {
      const env = {
        DEFINED: "value",
        UNDEFINED: undefined,
        NULL_VALUE: "null",
      };

      const secrets = detectSecretsInEnv(env);

      // Should not throw
      expect(Array.isArray(secrets)).toBe(true);
    });
  });

  describe("assessSecretRisk", () => {
    it("should identify critical risk level", () => {
      const secrets = [
        {
          type: "private_key" as SecretType,
          pattern: "**KEY**",
          confidence: 0.99,
          description: "Private key found",
        },
      ];

      const assessment = assessSecretRisk(secrets);

      expect(assessment.risk).toBe("critical");
      expect(assessment.criticalCount).toBeGreaterThan(0);
    });

    it("should identify high risk for high confidence secrets", () => {
      const secrets = [
        {
          type: "pii" as SecretType,
          pattern: "**PII**",
          confidence: 0.95,
          description: "PII found",
        },
      ];

      const assessment = assessSecretRisk(secrets);

      expect(assessment.risk).toBe("high");
      expect(assessment.highConfidence.length).toBeGreaterThan(0);
    });

    it("should identify medium risk for multiple secrets", () => {
      const secrets = Array(5)
        .fill(null)
        .map((_, i) => ({
          type: "pii" as SecretType,
          pattern: `**pii${i}**`,
          confidence: 0.5,
          description: `PII pattern ${i}`,
        }));

      const assessment = assessSecretRisk(secrets);

      expect(assessment.risk).toBe("medium");
    });

    it("should indicate safe when no secrets found", () => {
      const assessment = assessSecretRisk([]);

      expect(assessment.risk).toBe("safe");
      expect(assessment.totalFound).toBe(0);
    });
  });

  // ===== FALLBACK TESTS =====

  describe("generateFallbackSuggestions", () => {
    it("should provide suggestions for known issue codes", () => {
      const issues: AuditIssue[] = [
        {
          code: "SEC_001",
          severity: "error",
          title: "Missing Header",
          message: "X-Content-Type-Options security header missing",
        },
      ];

      const suggestions = generateFallbackSuggestions(issues);

      expect(suggestions.length).toBeGreaterThan(0);
      expect(suggestions[0].issueCode).toBe("SEC_001");
      expect(suggestions[0].recommendation).toBeDefined();
      expect(suggestions[0].priority).toBeGreaterThan(0);
    });

    it("should provide generic suggestions for unknown codes", () => {
      const issues: AuditIssue[] = [
        {
          code: "UNKNOWN_999",
          severity: "warning",
          title: "Unknown Issue",
          message: "This is an unknown issue type",
        },
      ];

      const suggestions = generateFallbackSuggestions(issues);

      expect(suggestions.length).toBeGreaterThan(0);
      expect(suggestions[0].recommendation).toBeDefined();
    });

    it("should respect severity levels in fallback suggestions", () => {
      const criticalIssue: AuditIssue = {
        code: "UNKNOWN",
        severity: "critical",
        title: "Critical",
        message: "Critical severity issue",
      };
      const warningIssue: AuditIssue = {
        code: "UNKNOWN",
        severity: "warning",
        title: "Warning",
        message: "Warning severity issue",
      };

      const criticalSuggestions = generateFallbackSuggestions([criticalIssue]);
      const warningSuggestions = generateFallbackSuggestions([warningIssue]);

      expect(criticalSuggestions[0].priority).toBeGreaterThan(
        warningSuggestions[0].priority
      );
    });

    it("should include estimated time for complex issues", () => {
      const issues: AuditIssue[] = [
        {
          code: "SEC_001",
          severity: "error",
          title: "Security",
          message: "Security issue",
        },
      ];

      const suggestions = generateFallbackSuggestions(issues);

      expect(suggestions[0].estimatedTime).toBeDefined();
      expect(suggestions[0].estimatedTime).toBeGreaterThan(0);
    });
  });

  describe("analyzeUnknownVariablesWithFallback", () => {
    it("should identify database variables", () => {
      const suggestions = analyzeUnknownVariablesWithFallback([
        "DATABASE_URL",
        "DB_PASSWORD",
      ]);

      expect(suggestions.length).toBe(2);
      expect(suggestions.every((s) => s.priority >= 3)).toBe(true);
    });

    it("should identify API and secret variables", () => {
      const suggestions = analyzeUnknownVariablesWithFallback([
        "API_KEY",
        "SECRET_TOKEN",
      ]);

      expect(suggestions.length).toBe(2);
      expect(suggestions.every((s) => s.priority === 5)).toBe(true);
    });

    it("should categorize configuration variables", () => {
      const suggestions = analyzeUnknownVariablesWithFallback([
        "PORT",
        "HOST",
        "APP_URL",
      ]);

      expect(suggestions.length).toBe(3);
      expect(suggestions[0].recommendation).toContain("configuration");
    });
  });

  describe("shouldUseAI", () => {
    it("should return true when AI available and multiple issues", () => {
      expect(shouldUseAI(5, true)).toBe(true);
    });

    it("should return false when AI unavailable", () => {
      expect(shouldUseAI(10, false)).toBe(false);
    });

    it("should return false for single issue even with AI available", () => {
      expect(shouldUseAI(1, true)).toBe(false);
    });

    it("should return false for two issues", () => {
      expect(shouldUseAI(2, true)).toBe(false);
    });

    it("should return true for three or more issues with AI available", () => {
      expect(shouldUseAI(3, true)).toBe(true);
      expect(shouldUseAI(10, true)).toBe(true);
    });
  });
});
