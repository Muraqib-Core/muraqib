import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ExplainCache } from "../../../../src/agent-v2/explain/cache.js";
import { GEMINI_MODEL, MODEL_ENV, resolveModel } from "../../../../src/agent-v2/explain/config.js";
import { explainPlan } from "../../../../src/agent-v2/explain/explainer.js";
import { describeGeminiError, isTransientError, transientLabel, type TextGenerator } from "../../../../src/agent-v2/explain/gemini.js";
import { AGENT_PLAN_SCHEMA_VERSION, type AgentPlan } from "../../../../src/agent-v2/types.js";

const FAKE_KEY = ["fake", "key", "for", "tests", "123456"].join("-");

describe("resolveModel", () => {
  test("defaults to the central model", () => {
    expect(resolveModel({})).toBe(GEMINI_MODEL);
    expect(GEMINI_MODEL).toBe("gemini-flash-lite-latest");
  });

  test("uses a valid override, trimmed", () => {
    expect(resolveModel({ [MODEL_ENV]: "  gemini-3.5-flash " })).toBe("gemini-3.5-flash");
  });

  test.each(["", "   ", "bad name", "x/y", "a".repeat(80), "-leading", "$(rm)"])("ignores %j", (value) => {
    expect(resolveModel({ [MODEL_ENV]: value })).toBe(GEMINI_MODEL);
  });
});

describe("transient errors", () => {
  test("429 and 503 are transient, other errors are not", () => {
    expect(isTransientError({ status: 429 })).toBe(true);
    expect(isTransientError({ status: 503 })).toBe(true);
    expect(isTransientError({ message: "RESOURCE_EXHAUSTED" })).toBe(true);
    expect(isTransientError({ message: "503 UNAVAILABLE: overloaded" })).toBe(true);
    expect(isTransientError({ status: 404 })).toBe(false);
    expect(isTransientError({ status: 400 })).toBe(false);
    expect(isTransientError("boom")).toBe(false);
    expect(isTransientError(null)).toBe(false);
  });

  test("labels", () => {
    expect(transientLabel({ status: 429 })).toBe("rate limit (429)");
    expect(transientLabel({ status: 503 })).toBe("unavailable (503)");
  });

  test("a 404 hint says the model may be retired and how to change it", () => {
    const text = describeGeminiError({ status: 404 });
    expect(text).toContain("model not found or no longer available");
    expect(text).toContain("MURAQIB_AGENT_MODEL");
  });
});

describe("explainPlan retries a 503 like a 429", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "agent-v2-503-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function plan(): AgentPlan {
    return {
      schemaVersion: AGENT_PLAN_SCHEMA_VERSION,
      projectRoot: "/p",
      verdict: "fail",
      ok: true,
      summary: { total: 1, autoFixable: 1, manual: 0, byFixClass: { "floating-promise": 1, "hardcoded-secret": 0, "env-documentation": 0, manual: 0 } },
      steps: [{ rank: 1, issueId: "id-1", module: "m", code: "C", severity: "error", title: "T", fixClass: "floating-promise", autoFixable: true, file: "src/a.ts", line: 1, reasons: [] }],
    };
  }

  const unavailable = (): Error & { status: number } => Object.assign(new Error("overloaded"), { status: 503 });

  test("503 twice then success: waits 1000 then 2000 and ends in llm mode", async () => {
    const generate = vi.fn().mockRejectedValueOnce(unavailable()).mockRejectedValueOnce(unavailable()).mockResolvedValue(JSON.stringify({ explanations: [{ id: "id-1", text: "Explained." }] }));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const generator: TextGenerator = { generate };
    const out = await explainPlan(plan(), {}, { generator, apiKey: FAKE_KEY, cache: new ExplainCache(dir), sleep });
    expect(out.explainer?.mode).toBe("llm");
    expect(out.explainer?.calls).toBe(3);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([1000, 2000]);
  });

  test("503 every time: falls back with a clear note, calls stay within the ceiling", async () => {
    const generate = vi.fn().mockRejectedValue(unavailable());
    const out = await explainPlan(plan(), {}, { generator: { generate }, apiKey: FAKE_KEY, cache: new ExplainCache(dir), sleep: async () => {} });
    expect(out.explainer?.mode).toBe("fallback");
    expect(out.explainer?.notice).toContain("unavailable (503) persisted after retries");
    expect(generate.mock.calls.length).toBeLessThanOrEqual(3);
  });

  test("the model reported is the resolved one", async () => {
    const previous = process.env[MODEL_ENV];
    process.env[MODEL_ENV] = "gemini-3.5-flash";
    try {
      const generate = vi.fn().mockResolvedValue(JSON.stringify({ explanations: [{ id: "id-1", text: "Explained." }] }));
      const out = await explainPlan(plan(), {}, { generator: { generate }, apiKey: FAKE_KEY, cache: new ExplainCache(dir), sleep: async () => {} });
      expect(out.explainer?.model).toBe("gemini-3.5-flash");
    } finally {
      if (previous === undefined) delete process.env[MODEL_ENV];
      else process.env[MODEL_ENV] = previous;
    }
  });
});
