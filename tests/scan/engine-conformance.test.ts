import test from "node:test";
import assert from "node:assert/strict";
import { CustomValidationEngine } from "../../src/scan/guard/engines/custom-engine.js";
import { ZodValidationEngine } from "../../src/scan/guard/engines/zod-engine.js";
import { ValibotValidationEngine } from "../../src/scan/guard/engines/valibot-engine.js";
import { ArkTypeValidationEngine } from "../../src/scan/guard/engines/arktype-engine.js";
import type { ValidationEngine } from "../../src/scan/core/contracts/validation-engine.js";

const engines: ValidationEngine[] = [
  new CustomValidationEngine(),
  new ZodValidationEngine(),
  new ValibotValidationEngine(),
  new ArkTypeValidationEngine(),
];

test("Engine Conformance: All engines pass for clean, valid environment", () => {
  const validEnv: Record<string, string> = {
    NODE_ENV: "production",
    PORT: "3000",
    JWT_SECRET: "super-secret-key-that-is-at-least-32-chars-long!",
    DATABASE_URL: "postgresql://user:pass@localhost:5432/mydb",
  };

  for (const engine of engines) {
    const result = engine.validate(validEnv, ["app", "auth", "neon"]);
    assert.equal(
      result.errors.length,
      0,
      `Engine '${engine.name}' failed with errors: ${JSON.stringify(result.errors)}`
    );
  }
});

test("Engine Conformance: All engines catch invalid PORT", () => {
  const invalidPortEnv = {
    PORT: "99999", // > 65535
  };

  for (const engine of engines) {
    const result = engine.validate(invalidPortEnv, ["app"]);
    const portError = result.errors.find((e) => e.path.includes("PORT"));
    assert.ok(
      portError,
      `Engine '${engine.name}' did not flag invalid PORT`
    );
  }
});

test("Engine Conformance: All engines catch weak JWT_SECRET", () => {
  const weakSecretEnv = {
    JWT_SECRET: "too-short",
  };

  for (const engine of engines) {
    const result = engine.validate(weakSecretEnv, ["auth"]);
    const secretError = result.errors.find((e) => e.path.includes("JWT_SECRET"));
    assert.ok(
      secretError,
      `Engine '${engine.name}' did not flag weak JWT_SECRET`
    );
  }
});

test("Engine Conformance: All engines catch invalid DATABASE_URL", () => {
  const badDbEnv = {
    DATABASE_URL: "ftp://not-a-db-url",
  };

  for (const engine of engines) {
    const result = engine.validate(badDbEnv, ["neon"]);
    const dbError = result.errors.find((e) => e.path.includes("DATABASE_URL"));
    assert.ok(
      dbError,
      `Engine '${engine.name}' did not flag invalid DATABASE_URL`
    );
  }
});

test("Engine Conformance: All engines identify custom unknown keys", () => {
  const envWithCustom = {
    CUSTOM_FLAG: "true",
    MY_CUSTOM_VAR: "hello",
  };

  for (const engine of engines) {
    const result = engine.validate(envWithCustom, ["app"]);
    assert.ok(result.unknownKeys.includes("CUSTOM_FLAG"));
    assert.ok(result.unknownKeys.includes("MY_CUSTOM_VAR"));
  }
});
