import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { AuditIssue, AuditResult } from "../../../src/core/types.js";

const generateContent = vi.fn();
vi.mock("@google/genai", () => ({
  GoogleGenAI: vi.fn(function () {
    return { models: { generateContent } };
  }),
}));

import {
  generateAdvisory,
  generateAuditAdvisory,
  generateFindingsAdvisory,
  resolveApiKey,
} from "../../../src/ai/advisor.js";

const issue = (over: Partial<AuditIssue> = {}): AuditIssue => ({
  code: "SEC_001",
  severity: "error",
  title: "Missing header",
  message: "X-Frame-Options not set",
  ...over,
});

const reply = (text: string): unknown => ({
  candidates: [{ content: { parts: [{ text }] } }],
});

describe("advisor", () => {
  beforeEach(() => {
    generateContent.mockReset();
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("GOOGLE_API_KEY", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("resolveApiKey", () => {
    test("prefers explicit, then GEMINI_API_KEY, then GOOGLE_API_KEY", () => {
      vi.stubEnv("GEMINI_API_KEY", "g");
      vi.stubEnv("GOOGLE_API_KEY", "o");
      expect(resolveApiKey("explicit")).toBe("explicit");
      expect(resolveApiKey()).toBe("g");
      vi.stubEnv("GEMINI_API_KEY", "");
      expect(resolveApiKey()).toBe("o");
      vi.stubEnv("GOOGLE_API_KEY", "");
      expect(resolveApiKey()).toBeUndefined();
    });
  });

  describe("generateAdvisory", () => {
    test("fails fast without an API key", async () => {
      const result = await generateAdvisory([issue()]);
      expect(result.success).toBe(false);
      expect(result.error).toContain("API key");
      expect(generateContent).not.toHaveBeenCalled();
    });

    test("succeeds with no suggestions when every issue is empty", async () => {
      const result = await generateAdvisory([issue({ code: "" }), issue({ message: "" })], {
        apiKey: "k",
      });
      expect(result).toMatchObject({ success: true, suggestions: [] });
      expect(generateContent).not.toHaveBeenCalled();
    });

    test("parses a raw JSON array and clamps priority", async () => {
      generateContent.mockResolvedValue(
        reply(
          JSON.stringify([
            {
              issueCode: "SEC_001",
              recommendation: "do it",
              codeExample: "x()",
              docLink: "http://d",
              priority: 99,
              estimatedTime: 7,
            },
            { issueCode: "B", recommendation: "r", priority: "nan" },
            { issueCode: "C" },
            "junk",
            null,
          ])
        )
      );
      const result = await generateAdvisory([issue()], { apiKey: "k", model: "m" });
      expect(generateContent).toHaveBeenCalledWith(expect.objectContaining({ model: "m" }));
      expect(result.success).toBe(true);
      expect(result.suggestions).toHaveLength(2);
      expect(result.suggestions[0]).toMatchObject({
        priority: 5,
        codeExample: "x()",
        docLink: "http://d",
        estimatedTime: 7,
      });
      expect(result.suggestions[1]?.priority).toBe(3);
    });

    test("extracts JSON from a fenced code block", async () => {
      generateContent.mockResolvedValue(
        reply('Here:\n```json\n[{"issueCode":"A","recommendation":"r","priority":2}]\n```')
      );
      const result = await generateAdvisory([issue()], { apiKey: "k" });
      expect(result.suggestions).toHaveLength(1);
    });

    test("redacts secrets before sending the prompt", async () => {
      generateContent.mockResolvedValue(reply("[]"));
      await generateAdvisory(
        [issue({ message: `leaked ghp_${"a".repeat(36)} here`, title: undefined as never })],
        { apiKey: "k" }
      );
      const sent = JSON.stringify(generateContent.mock.calls[0]?.[0]);
      expect(sent).not.toContain("a".repeat(36));
    });

    test("returns no suggestions for non-array or invalid JSON and for odd response shapes", async () => {
      for (const response of [
        reply("{}"),
        reply("not json"),
        {},
        { candidates: [] },
        { candidates: [{}] },
        { candidates: [{ content: { parts: [] } }] },
        { candidates: [{ content: { parts: [{ text: 5 }] } }] },
        null,
      ]) {
        generateContent.mockResolvedValueOnce(response);
        const result = await generateAdvisory([issue()], { apiKey: "k" });
        expect(result.success).toBe(true);
        expect(result.suggestions).toEqual([]);
      }
    });

    test("returns the error message when the client throws", async () => {
      generateContent.mockRejectedValue(new Error("quota"));
      const result = await generateAdvisory([issue()], { apiKey: "k" });
      expect(result).toMatchObject({ success: false, error: "quota" });
      generateContent.mockRejectedValue("plain string");
      expect((await generateAdvisory([issue()], { apiKey: "k" })).error).toBe("plain string");
    });
  });

  describe("generateAuditAdvisory", () => {
    test("only sends critical and error issues", async () => {
      generateContent.mockResolvedValue(reply("[]"));
      const auditResult = {
        issues: [
          issue({ code: "A", severity: "critical" }),
          issue({ code: "B", severity: "error" }),
          issue({ code: "C", severity: "warning" }),
          issue({ code: "D", severity: "info" }),
        ],
      } as unknown as AuditResult;
      await generateAuditAdvisory(auditResult, { apiKey: "k" });
      const sent = JSON.stringify(generateContent.mock.calls[0]?.[0]);
      expect(sent).toContain("Code: A");
      expect(sent).toContain("Code: B");
      expect(sent).not.toContain("Code: C");
      expect(sent).not.toContain("Code: D");
    });
  });

  describe("generateFindingsAdvisory", () => {
    const scanIssue = {
      code: "osv-lodash",
      severity: "error",
      title: "Dep problem",
      message: "vulnerable",
      source: "osv",
      recommendation: "upgrade",
    } as never;

    test("returns null without a key or without findings", async () => {
      expect(await generateFindingsAdvisory([scanIssue])).toBeNull();
      expect(await generateFindingsAdvisory([], {}, { apiKey: "k" })).toBeNull();
    });

    test("returns the trimmed text for scan issues", async () => {
      generateContent.mockResolvedValue({ text: "  advice  " });
      const out = await generateFindingsAdvisory([scanIssue], { lodash: "4.0.0" }, { apiKey: "k" });
      expect(out).toBe("advice");
      const sent = String(generateContent.mock.calls[0]?.[0]?.contents);
      expect(sent).toContain("[osv] Dep problem: vulnerable (Remediation: upgrade)");
      expect(sent).toContain('"lodash": "4.0.0"');
    });

    test("supports core Finding objects with a structured source and description", async () => {
      generateContent.mockResolvedValue({ text: "ok" });
      const finding = {
        title: "T",
        description: "desc",
        source: { module: "security-guard" },
      } as never;
      await generateFindingsAdvisory([finding], {}, { apiKey: "k" });
      const sent = String(generateContent.mock.calls[0]?.[0]?.contents);
      expect(sent).toContain("[security-guard] T: desc (Remediation: N/A)");
    });

    test("returns null when the response has no text or the call fails", async () => {
      generateContent.mockResolvedValueOnce({});
      expect(await generateFindingsAdvisory([scanIssue], {}, { apiKey: "k" })).toBeNull();
      generateContent.mockRejectedValueOnce(new Error("x"));
      expect(await generateFindingsAdvisory([scanIssue], {}, { apiKey: "k" })).toBeNull();
    });
  });
});
