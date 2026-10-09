import test from "node:test";
import assert from "node:assert/strict";
import {
  isSensitiveKey,
  isSensitiveValue,
  redactValue,
  extractSafeMetadata,
} from "../../src/scan/ai/secret-detector.js";

test("AI Boundary: detects sensitive variable names", () => {
  assert.ok(isSensitiveKey("JWT_SECRET"));
  assert.ok(isSensitiveKey("DATABASE_PASSWORD"));
  assert.ok(isSensitiveKey("AWS_SECRET_ACCESS_KEY"));
  assert.ok(isSensitiveKey("API_KEY"));
  assert.ok(isSensitiveKey("OAUTH_TOKEN"));
  assert.ok(isSensitiveKey("PRIVATE_KEY"));

  assert.equal(isSensitiveKey("PORT"), false);
  assert.equal(isSensitiveKey("NODE_ENV"), false);
  assert.equal(isSensitiveKey("APP_NAME"), false);
});

test("AI Boundary: detects sensitive values (JWT, credential URLs, private keys)", () => {
  assert.ok(isSensitiveValue("postgresql://postgres:mysecretpassword@localhost:5432/db"));
  assert.ok(isSensitiveValue("eyJh.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgN"));
  assert.ok(isSensitiveValue("-----BEGIN PRIVATE KEY-----\nMIIEvgIBADAN..."));

  assert.equal(isSensitiveValue("development"), false);
  assert.equal(isSensitiveValue("3000"), false);
  assert.equal(isSensitiveValue("https://example.com/api"), false);
});

test("AI Boundary: redacts sensitive keys and sensitive values", () => {
  assert.equal(redactValue("API_KEY", "real-secret-12345"), "[REDACTED]");
  assert.equal(
    redactValue("CUSTOM_URL", "postgresql://admin:secret123@db.host.com/prod"),
    "[REDACTED]"
  );
  assert.equal(redactValue("PORT", "8080"), "8080");
});

test("AI Boundary: extracts metadata without exposing plaintext secrets", () => {
  const metadata = extractSafeMetadata(
    "DB_URL",
    "postgresql://admin:secret123@db.host.com/prod"
  );
  assert.equal(metadata.name, "DB_URL");
  assert.equal(metadata.classification, "url");
  assert.equal(metadata.hasCredentials, true);
  // Verify secret value is never part of metadata object
  assert.equal(Object.values(metadata).includes("secret123"), false);
});
