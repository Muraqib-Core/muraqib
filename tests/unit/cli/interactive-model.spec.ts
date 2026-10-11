import { describe, expect, test } from "vitest";
import {
  AUDIT_SCOPES,
  MODULE_CHOICES,
  buildAssistantPrompt,
  collectIssues,
  formatLocation,
  groupFixes,
  includesSecurity,
  moduleStatuses,
} from "../../../src/cli/interactive-model.js";
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

describe("audit scopes", () => {
  test("the full scope runs everything and every named scope lists modules", () => {
    const byId = Object.fromEntries(AUDIT_SCOPES.map((s) => [s.id, s]));
    expect(byId["full"]?.modules).toEqual([]);
    for (const id of ["security", "performance", "config", "quality"]) expect(byId[id]?.modules.length).toBeGreaterThan(0);
    expect(AUDIT_SCOPES.map((s) => s.id)).toContain("custom");
  });

  test("every module filter used by a scope is selectable individually", () => {
    const offered = new Set(MODULE_CHOICES.map((m) => m.value));
    for (const scope of AUDIT_SCOPES) for (const m of scope.modules) expect(offered.has(m), m).toBe(true);
  });

  test("includesSecurity: empty means all, otherwise needs a matching filter", () => {
    expect(includesSecurity([])).toBe(true);
    expect(includesSecurity(["Security"])).toBe(true);
    expect(includesSecurity(["image", "memory"])).toBe(false);
  });
});

describe("collectIssues", () => {
  test("flattens valid issues, most severe first, skipping malformed entries", () => {
    const issues = collectIssues(report);
    expect(issues.map((i) => i.severity)).toEqual(["critical", "error", "warning", "warning", "info"]);
    expect(issues[0]).toMatchObject({ module: "security-guard", file: "server.ts", line: 4, recommendation: "Enable HSTS" });
    expect(issues[1]?.line).toBeUndefined();
  });

  test("falls back to defaults for missing title/message", () => {
    const flat = collectIssues({ ...report, modules: { m: { issues: [{ severity: "info" }] } } });
    expect(flat[0]).toMatchObject({ title: "Issue", message: "" });
  });
});

describe("moduleStatuses", () => {
  test("reports counts and worst severity, skipping non-module entries", () => {
    expect(moduleStatuses(report)).toEqual([
      { name: "config-guard", count: 2, worst: "warning" },
      { name: "security-guard", count: 3, worst: "critical" },
      { name: "memory-guard", count: 0, worst: null },
    ]);
  });
});

describe("groupFixes", () => {
  test("merges identical recommendations and ranks by severity then frequency", () => {
    const fixes = groupFixes(collectIssues(report));
    expect(fixes).toEqual([
      { recommendation: "Enable HSTS", severity: "critical", count: 1, modules: ["security-guard"] },
      { recommendation: "Add a license field", severity: "warning", count: 2, modules: ["config-guard"] },
    ]);
  });

  test("keeps the most severe level and every module of a shared recommendation", () => {
    const fixes = groupFixes([
      { module: "a", severity: "warning", title: "t", message: "m", recommendation: "r" },
      { module: "b", severity: "error", title: "t", message: "m", recommendation: "r" },
    ]);
    expect(fixes).toEqual([{ recommendation: "r", severity: "error", count: 2, modules: ["a", "b"] }]);
  });
});

describe("formatLocation", () => {
  test.each([
    [{ file: "a.ts", line: 3 }, "a.ts:3"],
    [{ file: "a.ts" }, "a.ts"],
    [{}, ""],
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
