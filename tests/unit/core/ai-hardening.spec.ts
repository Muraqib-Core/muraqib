import { describe, it, expect, vi, beforeEach } from "vitest";

const generateContent = vi.fn();
vi.mock("@google/genai", () => ({
  GoogleGenAI: vi.fn(function () {
    return { models: { generateContent } };
  }),
}));

import { resolveApiKey, generateFindingsAdvisory, generateAdvisory } from "../../../src/ai/advisor";
import { analyzeUnknownVariablesWithAi } from "../../../src/ai/fallback";
import { redactSecretsInText, extractSafeMetadata } from "../../../src/ai/safe-metadata";
import type { Finding } from "../../../src/core/findings/finding";

beforeEach(() => {
  generateContent.mockReset();
  delete process.env.GEMINI_API_KEY;
  delete process.env.GOOGLE_API_KEY;
});

describe("API key resolution", () => {
  it("prefers explicit, then GEMINI_API_KEY, then GOOGLE_API_KEY", () => {
    process.env.GOOGLE_API_KEY = "g";
    expect(resolveApiKey()).toBe("g");
    process.env.GEMINI_API_KEY = "m";
    expect(resolveApiKey()).toBe("m");
    expect(resolveApiKey("x")).toBe("x");
  });
});

describe("secret redaction", () => {
  it("redacts credentials, JWTs and tokens", () => {
    const text = "db postgres://user:pa55@host/db jwt eyJhbGciOi.eyJzdWIi.sig token=abc123 Bearer abc.def";
    const out = redactSecretsInText(text);
    expect(out).not.toContain("pa55");
    expect(out).not.toContain("eyJhbGciOi");
    expect(out).not.toContain("abc123");
    expect(out).not.toContain("abc.def");
  });
  it("extractSafeMetadata never returns the value", () => {
    const m = extractSafeMetadata("API_SECRET", "hunter2");
    expect(JSON.stringify(m)).not.toContain("hunter2");
    expect(m.hasCredentials).toBe(true);
  });
});

describe("prompts never leak secrets", () => {
  it("generateAdvisory redacts issue text", async () => {
    generateContent.mockResolvedValue({ candidates: [] });
    await generateAdvisory(
      [{ code: "C", severity: "error", title: "t", message: "leak token=TOPSECRET", tags: [] }],
      { apiKey: "k" }
    );
    expect(JSON.stringify(generateContent.mock.calls[0])).not.toContain("TOPSECRET");
  });

  it("generateFindingsAdvisory returns null without key / findings", async () => {
    expect(await generateFindingsAdvisory([])).toBeNull();
    const f = { source: "osv", title: "t", description: "d", recommendation: "r" } as unknown as Finding;
    expect(await generateFindingsAdvisory([f])).toBeNull();
  });

  it("generateFindingsAdvisory sends redacted text and returns trimmed output", async () => {
    process.env.GEMINI_API_KEY = "k";
    generateContent.mockResolvedValue({ text: "  advice \n" });
    const f = { source: "osv", title: "t", description: "password=hunter2", recommendation: "r" } as unknown as Finding;
    expect(await generateFindingsAdvisory([f])).toBe("advice");
    expect(generateContent.mock.calls[0][0].contents).not.toContain("hunter2");
  });

  it("generateFindingsAdvisory accepts scan issues and includes the layout rules", async () => {
    process.env.GEMINI_API_KEY = "k";
    generateContent.mockResolvedValue({ text: "advice" });
    const issue = { code: "C", severity: "error", title: "t", message: "password=hunter2", source: "osv", recommendation: "Upgrade x", tags: [] } as unknown as Parameters<typeof generateFindingsAdvisory>[0][number];
    expect(await generateFindingsAdvisory([issue])).toBe("advice");
    const contents = generateContent.mock.calls[0][0].contents as string;
    expect(contents).not.toContain("hunter2");
    expect(contents).toContain("[osv]");
    expect(contents).toContain("Actionable Remediation");
  });

  it("analyzeUnknownVariablesWithAi sends metadata only", async () => {
    process.env.GEMINI_API_KEY = "k";
    generateContent.mockResolvedValue({ text: '[{"path":["API_URL"],"message":"bad url"}]' });
    const r = await analyzeUnknownVariablesWithAi(["API_URL"], { API_URL: "http://u:SECRETPW@h" });
    expect(r).toEqual([{ path: ["API_URL"], message: "bad url" }]);
    expect(generateContent.mock.calls[0][0].contents).not.toContain("SECRETPW");
  });

  it("returns [] on AI failure", async () => {
    process.env.GEMINI_API_KEY = "k";
    generateContent.mockRejectedValue(new Error("boom"));
    expect(await analyzeUnknownVariablesWithAi(["A"], { A: "1" })).toEqual([]);
  });
});
