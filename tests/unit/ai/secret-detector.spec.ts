import { describe, expect, test } from "vitest";
import {
  assessSecretRisk,
  detectSecretsInEnv,
  detectSecretsInText,
  type DetectedSecret,
} from "../../../src/ai/secret-detector.js";

const secret = (type: DetectedSecret["type"], confidence: number): DetectedSecret => ({
  type,
  pattern: "xx***yy",
  confidence,
  description: "test",
});

describe("detectSecretsInText", () => {
  test("detects a Stripe live secret key and masks it", () => {
    const key = `sk_live_${"a".repeat(24)}`;
    const found = detectSecretsInText(`const k = "${key}";`);
    const hit = found.find((s) => s.description === "Stripe secret key");
    expect(hit).toBeDefined();
    expect(hit?.type).toBe("api_key");
    expect(hit?.pattern).not.toContain(key);
    expect(hit?.pattern).toContain("*");
  });

  test("detects GitHub tokens, AWS key ids and private keys", () => {
    const text = [
      `token=ghp_${"b".repeat(36)}`,
      "id=AKIAABCDEFGHIJKLMNOP",
      "-----BEGIN RSA PRIVATE KEY-----",
      "-----BEGIN CERTIFICATE-----",
    ].join("\n");
    const descriptions = detectSecretsInText(text).map((s) => s.description);
    expect(descriptions).toContain("GitHub personal access token");
    expect(descriptions).toContain("AWS access key ID");
    expect(descriptions).toContain("Private key PEM block");
    expect(descriptions).toContain("SSL/TLS certificate");
  });

  test("detects password, database, oauth and webhook assignments", () => {
    const text = [
      `password = "hunter2hunter2"`,
      `DATABASE_URL = "postgres://u:p@h/db"`,
      `oauth_token: "abc123"`,
      `webhook_secret = "whsec_123"`,
      `Authorization: Bearer abc.def-ghi `,
    ].join("\n");
    const types = detectSecretsInText(text).map((s) => s.type);
    expect(types).toContain("password");
    expect(types).toContain("db_credential");
    expect(types).toContain("oauth_token");
    expect(types).toContain("webhook_secret");
    expect(types).toContain("bearer_token");
  });

  test("computes the line number from the match position", () => {
    const text = `line one\nline two\npassword = "secret-value"`;
    const hit = detectSecretsInText(text).find((s) => s.type === "password");
    expect(hit?.line).toBe(3);
  });

  test("uses the supplied file info instead of computing the line", () => {
    const hit = detectSecretsInText(`password = "secret-value"`, {
      file: ".env",
      line: 9,
    }).find((s) => s.type === "password");
    expect(hit?.file).toBe(".env");
    expect(hit?.line).toBe(9);
  });

  test("reports an identical match only once", () => {
    const text = `password = "dup-value"\npassword = "dup-value"`;
    const hits = detectSecretsInText(text).filter((s) => s.type === "password");
    expect(hits).toHaveLength(1);
  });

  test("returns nothing for clean text", () => {
    expect(detectSecretsInText("const answer = 'hello';")).toEqual([]);
  });

  test("masks very short matches completely", () => {
    // PII pattern can match short numeric strings of 4 chars or fewer.
    const found = detectSecretsInText("id 1234 end");
    const pii = found.find((s) => s.type === "pii");
    expect(pii?.pattern).toBe("****");
  });
});

describe("detectSecretsInEnv", () => {
  test("flags variables with sensitive-looking names", () => {
    const found = detectSecretsInEnv({ API_TOKEN: "abcdefghij", PLAIN: "value" });
    const flagged = found.filter((s) => s.description.includes("API_TOKEN"));
    expect(flagged).toHaveLength(1);
    expect(flagged[0]?.confidence).toBe(0.6);
  });

  test("skips empty and undefined values", () => {
    expect(detectSecretsInEnv({ SECRET: "", TOKEN: undefined })).toEqual([]);
  });

  test("scans values for known patterns and tags the variable name", () => {
    const found = detectSecretsInEnv({ CONFIG: `ghp_${"c".repeat(36)}` });
    const hit = found.find((s) => s.description === "GitHub personal access token");
    expect(hit?.file).toBe("CONFIG");
  });
});

describe("assessSecretRisk", () => {
  test("is safe when nothing was found", () => {
    expect(assessSecretRisk([])).toMatchObject({ risk: "safe", totalFound: 0 });
  });

  test("is critical for api keys, passwords and private keys", () => {
    const result = assessSecretRisk([secret("password", 0.7)]);
    expect(result.risk).toBe("critical");
    expect(result.criticalCount).toBe(1);
  });

  test("is high when only high-confidence non-critical secrets exist", () => {
    const result = assessSecretRisk([secret("certificate", 0.98)]);
    expect(result.risk).toBe("high");
    expect(result.highConfidence).toHaveLength(1);
  });

  test("is medium for more than three low-confidence findings", () => {
    const many = Array.from({ length: 4 }, () => secret("pii", 0.5));
    expect(assessSecretRisk(many).risk).toBe("medium");
  });

  test("is low for a few low-confidence findings", () => {
    expect(assessSecretRisk([secret("pii", 0.5)]).risk).toBe("low");
  });
});
