import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { AuditIssue } from "../../src/core/types.js";

// Simulate every optional peer dependency being absent.
vi.mock("../../src/utils/optional-dependency.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/utils/optional-dependency.js")>();
  const reject = (pkg: string, feature: string): never => {
    throw new actual.MissingOptionalDependencyError(pkg, feature);
  };
  return {
    ...actual,
    loadOptionalDependency: vi.fn(async (pkg: string, feature: string) => reject(pkg, feature)),
    requireOptionalDependency: vi.fn((pkg: string, feature: string) => reject(pkg, feature)),
  };
});

import { ValibotValidationEngine } from "../../src/scan/guard/engines/valibot-engine.js";
import { ArkTypeValidationEngine } from "../../src/scan/guard/engines/arktype-engine.js";
import { ValibotEngine } from "../../src/guard/engines/valibot-engine.js";
import { generateAdvisory, generateFindingsAdvisory } from "../../src/ai/advisor.js";
import { analyzeUnknownVariablesWithAi } from "../../src/ai/fallback.js";
import { createEnv } from "../../src/scan/guard/env-validator.js";

const issue: AuditIssue = { code: "SEC_001", severity: "error", title: "t", message: "m", tags: ["x"] };

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.stubEnv("GEMINI_API_KEY", "key");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("missing validation engine dependencies", () => {
  test("valibot scan engine rejects with an install hint", async () => {
    await expect(new ValibotValidationEngine().validate({ PORT: "1" }, ["app"])).rejects.toThrow(
      "install valibot to use engine 'valibot'"
    );
  });

  test("arktype scan engine rejects with an install hint", async () => {
    await expect(new ArkTypeValidationEngine().validate({ PORT: "1" }, ["app"])).rejects.toThrow(
      "install arktype to use engine 'arktype'"
    );
  });

  test("createEnv surfaces the error for an explicitly selected engine", async () => {
    await expect(createEnv({ runtimeEnv: { PORT: "1" }, engine: "valibot" })).rejects.toThrow(
      "install valibot to use engine 'valibot'"
    );
  });

  test("public ValibotEngine.validate throws the install hint instead of an UNKNOWN_ERROR result", () => {
    const engine = new ValibotEngine({} as never);
    expect(() => engine.validate({})).toThrow("install valibot to use engine 'valibot'");
  });
});

describe("missing @google/genai", () => {
  test("generateAdvisory reports a failed result with the install hint", async () => {
    const result = await generateAdvisory([issue]);
    expect(result.success).toBe(false);
    expect(result.error).toContain("install @google/genai to use the Gemini AI advisor");
  });

  test("generateFindingsAdvisory returns null and warns once", async () => {
    const finding = issue;
    expect(await generateFindingsAdvisory([finding])).toBeNull();
    expect(await generateFindingsAdvisory([finding])).toBeNull();
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(vi.mocked(console.warn).mock.calls[0]?.[0]).toContain("install @google/genai");
  });

  test("analyzeUnknownVariablesWithAi degrades to an empty result", async () => {
    expect(await analyzeUnknownVariablesWithAi(["FOO"], { FOO: "bar" })).toEqual([]);
  });
});
