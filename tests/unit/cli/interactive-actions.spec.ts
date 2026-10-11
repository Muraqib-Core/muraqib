import { describe, expect, test } from "vitest";
import { buildAssistantPrompt, collectIssues, formatLocation, groupFixes } from "../../../src/cli/interactive-actions.js";
import type { AuditReport } from "../../../src/cli/types.js";

const report: AuditReport = {
  timestamp: 0,
  projectRoot: "/proj",
  summary: { total: 5, critical: 1, error: 1, warning: 2, info: 1 },
  modules: {
    "config-guard": {
      issues: [
        { severity: "warning", title: "Missing license", message: "No license", recommendation: "Add a license field" },
        { severity: "warning", title: "Missing description", message: "No description", recommendation: "Add a license field" },
      ],
    },
    "security-guard": {
      issues: [
        { severity: "critical", title: "No HSTS", message: "Header missing", location: { file: "server.ts", line: 4 }, recommendation: "Enable HSTS" },
        { severity: "error", title: "Open CORS", message: "Wildcard origin", location: { file: "server.ts" } },
        { severity: "info", title: "Note", message: "FYI" },
        { severity: "bogus", title: "Ignored", message: "bad severity" },
        "not an object",
      ],
    },
    "memory-guard": { issues: [] },
    "ai-advisory": { advisory: "text" },
  },
};

describe("collectIssues", () => {
  test("flattens valid issues, most severe first, skipping malformed entries", () => {
    const issues = collectIssues(report);
    expect(issues.map((i) => i.severity)).toEqual(["critical", "error", "warning", "warning", "info"]);
    expect(issues[0]).toMatchObject({ module: "security-guard", file: "server.ts", line: 4, recommendation: "Enable HSTS" });
    expect(issues[1]?.line).toBeUndefined();
  });

  test("falls back to defaults for missing title/message", () => {
    expect(collectIssues({ ...report, modules: { m: { issues: [{ severity: "info" }] } } })[0]).toMatchObject({ title: "Issue", message: "" });
  });
});

describe("groupFixes", () => {
  test("merges identical recommendations and ranks by severity then frequency", () => {
    expect(groupFixes(collectIssues(report))).toEqual([
      { recommendation: "Enable HSTS", severity: "critical", count: 1, modules: ["security-guard"] },
      { recommendation: "Add a license field", severity: "warning", count: 2, modules: ["config-guard"] },
    ]);
  });

  test("keeps the most severe level and every module of a shared recommendation", () => {
    expect(
      groupFixes([
        { module: "a", severity: "warning", title: "t", message: "m", recommendation: "r" },
        { module: "b", severity: "error", title: "t", message: "m", recommendation: "r" },
      ])
    ).toEqual([{ recommendation: "r", severity: "error", count: 2, modules: ["a", "b"] }]);
  });
});

describe("formatLocation", () => {
  test.each([
    [{ file: "a.ts", line: 3 }, "a.ts:3"],
    [{ file: "a.ts" }, "a.ts"],
    [{}, ""],
    [{ file: ".eslintignore", title: "Config: .eslintignore" }, ""],
    [{ file: ".eslintignore", line: 2, title: "Config: .eslintignore" }, ".eslintignore:2"],
  ])("%j -> %s", (loc, expected) => expect(formatLocation(loc)).toBe(expected));
});

describe("buildAssistantPrompt", () => {
  test("lists non-info issues by severity with locations and fixes, and the re-check command", () => {
    const prompt = buildAssistantPrompt(report);
    expect(prompt).toContain("/proj");
    expect(prompt).toContain("4 issue(s)");
    expect(prompt).toContain("1. [critical] No HSTS (server.ts:4) - Header missing. Suggested fix: Enable HSTS.");
    expect(prompt).toContain("2. [error] Open CORS (server.ts) - Wildcard origin.");
    expect(prompt).not.toContain("FYI");
    expect(prompt).toContain("npx muraqib agent --project /proj");
  });

  test("says how many were left out when over the limit", () => {
    expect(buildAssistantPrompt(report, 2)).toContain("(2 more not listed.)");
  });
});
