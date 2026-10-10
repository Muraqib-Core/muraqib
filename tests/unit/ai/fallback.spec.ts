import { beforeEach, describe, expect, test, vi } from "vitest";
import type { AuditIssue } from "../../../src/core/types.js";

const generateContent = vi.fn();
vi.mock("@google/genai", () => ({
  GoogleGenAI: vi.fn(function () {
    return { models: { generateContent } };
  }),
}));
vi.mock("../../../src/ai/advisor.js", () => ({ resolveApiKey: vi.fn() }));

import { resolveApiKey } from "../../../src/ai/advisor.js";
import {
  analyzeUnknownVariablesWithAi,
  analyzeUnknownVariablesWithFallback,
  generateFallbackSuggestions,
  shouldUseAI,
} from "../../../src/ai/fallback.js";

const issue = (code: string, severity: AuditIssue["severity"], message = "m"): AuditIssue => ({
  code,
  severity,
  title: "t",
  message,
});

describe("generateFallbackSuggestions", () => {
  test("uses the rule for a known code", () => {
    const [s] = generateFallbackSuggestions([issue("SEC_001", "error")]);
    expect(s?.issueCode).toBe("SEC_001");
    expect(s?.recommendation.length).toBeGreaterThan(10);
  });

  test("uses the rule whether or not the message matches its pattern", () => {
    const [matching] = generateFallbackSuggestions([issue("SEC_001", "error", "Missing header")]);
    const [other] = generateFallbackSuggestions([issue("SEC_001", "error", "zzz")]);
    expect(other?.recommendation).toBe(matching?.recommendation);
  });

  test("uses a generic suggestion per severity for unknown codes", () => {
    const out = generateFallbackSuggestions([
      issue("X1", "critical"),
      issue("X2", "error"),
      issue("X3", "warning"),
      issue("X4", "info"),
    ]);
    expect(out.map((s) => s.issueCode)).toEqual(["X1", "X2", "X3", "X4"]);
    expect(out[0]?.priority).toBeGreaterThan(out[3]?.priority ?? 99);
  });

  test("falls back to the info suggestion for an unrecognised severity", () => {
    const [s] = generateFallbackSuggestions([issue("X", "weird" as AuditIssue["severity"])]);
    expect(s?.recommendation).toBeTruthy();
  });

  test("returns an empty array for no issues", () => {
    expect(generateFallbackSuggestions([])).toEqual([]);
  });
});

describe("analyzeUnknownVariablesWithFallback", () => {
  test.each([
    ["DATABASE_NAME", "database configuration", 4],
    ["REDIS_SQL", "database configuration", 4],
    ["STRIPE_API", "API key or secret", 5],
    ["MY_SECRET", "API key or secret", 5],
    ["APP_PORT", "server configuration", 3],
    ["SOME_URL", "server configuration", 3],
    ["FOO", "not defined", 2],
  ])("classifies %s", (key, text, priority) => {
    const [s] = analyzeUnknownVariablesWithFallback([key]);
    expect(s?.issueCode).toBe(`UNKNOWN_VAR_${key}`);
    expect(s?.recommendation).toContain(text);
    expect(s?.priority).toBe(priority);
  });
});

describe("shouldUseAI", () => {
  test("requires availability and more than two issues", () => {
    expect(shouldUseAI(3, true)).toBe(true);
    expect(shouldUseAI(2, true)).toBe(false);
    expect(shouldUseAI(10, false)).toBe(false);
  });
});

describe("analyzeUnknownVariablesWithAi", () => {
  beforeEach(() => {
    generateContent.mockReset();
    vi.mocked(resolveApiKey).mockReturnValue("key");
  });

  test("returns [] without an API key or without keys", async () => {
    vi.mocked(resolveApiKey).mockReturnValue(undefined);
    expect(await analyzeUnknownVariablesWithAi(["A"], {})).toEqual([]);
    vi.mocked(resolveApiKey).mockReturnValue("key");
    expect(await analyzeUnknownVariablesWithAi([], {})).toEqual([]);
    expect(generateContent).not.toHaveBeenCalled();
  });

  test("returns well-formed items and never sends values", async () => {
    generateContent.mockResolvedValue({
      text: JSON.stringify([
        { path: ["A"], message: "bad" },
        { path: "nope", message: "x" },
        { path: ["B"], message: 5 },
        null,
      ]),
    });
    const out = await analyzeUnknownVariablesWithAi(["A"], { A: "super-secret-value" });
    expect(out).toEqual([{ path: ["A"], message: "bad" }]);
    const prompt = String(generateContent.mock.calls[0]?.[0]?.contents);
    expect(prompt).not.toContain("super-secret-value");
  });

  test("returns [] for empty text, non-array JSON and invalid JSON", async () => {
    generateContent.mockResolvedValueOnce({ text: "  " });
    expect(await analyzeUnknownVariablesWithAi(["A"], {})).toEqual([]);
    generateContent.mockResolvedValueOnce({ text: "{}" });
    expect(await analyzeUnknownVariablesWithAi(["A"], {})).toEqual([]);
    generateContent.mockResolvedValueOnce({ text: "not json" });
    expect(await analyzeUnknownVariablesWithAi(["A"], {})).toEqual([]);
  });

  test("fails closed when the API call throws", async () => {
    generateContent.mockRejectedValue(new Error("quota"));
    expect(await analyzeUnknownVariablesWithAi(["A"], {})).toEqual([]);
  });
});
