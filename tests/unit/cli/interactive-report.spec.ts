import { describe, expect, test } from "vitest";
import { AUDIT_CATEGORIES, resolveCategoryModules } from "../../../src/cli/interactive-policy.js";
import { buildNextSteps, getModuleViews, renderModuleIssues, renderOverview } from "../../../src/cli/interactive-report.js";
import type { AuditReport } from "../../../src/cli/types.js";

const issue = (severity: string, title = "t") => ({ severity, title, message: "m" });
const report: AuditReport = {
  timestamp: 0,
  projectRoot: "/p",
  summary: { total: 3, critical: 0, error: 1, warning: 1, info: 1 },
  modules: {
    "memory-guard": { issues: [issue("info")] },
    "dependency-guard": { issues: [issue("error")] },
    "config-guard": { issues: [] },
    "ai-advisory": { advisory: "text" },
  },
};

describe("resolveCategoryModules", () => {
  test("full or empty means no filter", () => {
    expect(resolveCategoryModules([])).toBeUndefined();
    expect(resolveCategoryModules(["security", "full"])).toBeUndefined();
  });
  test("merges and dedupes modules", () => {
    expect(resolveCategoryModules(["code", "code"])).toEqual(["dependency-guard", "dead-code-guard"]);
    expect(AUDIT_CATEGORIES[0]?.id).toBe("full");
  });
});

describe("report rendering", () => {
  test("modules sort worst first and tolerate non-issue payloads", () => {
    const names = getModuleViews(report).map((v) => v.name);
    expect(names[0]).toBe("dependency-guard");
    expect(names).toContain("ai-advisory");
  });
  test("overview marks clean and failing modules", () => {
    const out = renderOverview(getModuleViews(report));
    expect(out).toContain("clean");
    expect(out).toContain("1 issue(s)");
  });
  test("renderModuleIssues truncates with a count", () => {
    const view = { name: "x", issues: Array.from({ length: 7 }, () => issue("warning")) };
    expect(renderModuleIssues(view, 5)).toContain("and 2 more");
    expect(renderModuleIssues(view, Infinity)).not.toContain("more");
  });
  test("next steps map failing modules to commands", () => {
    const steps = buildNextSteps(report);
    expect(steps.map((s) => s.command)).toEqual(["muraqib resolve", "muraqib audit -m memory"]);
    expect(buildNextSteps({ ...report, modules: {} })).toEqual([]);
  });
});
