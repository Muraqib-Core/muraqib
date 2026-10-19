import { describe, expect, test } from "vitest";
import {
  buildNextSteps,
  getModuleViews,
  renderModuleIssues,
  renderOverview,
} from "../../../src/cli/interactive-report.js";
import type { AuditReport } from "../../../src/cli/types.js";

const base = { timestamp: 0, projectRoot: "/p", summary: { total: 0, critical: 0, error: 0, warning: 0, info: 0 } };
const mk = (modules: Record<string, unknown>): AuditReport => ({ ...base, modules } as AuditReport);
const issue = (severity: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  severity,
  title: "T",
  message: "M",
  ...extra,
});

describe("interactive-report extra branches", () => {
  test("handles null module payloads and non-array issues", () => {
    const views = getModuleViews(mk({ a: null, b: { issues: "nope" }, c: { issues: [issue("info"), { bad: 1 }, 5] } }));
    expect(views.find((v) => v.name === "a")?.issues).toEqual([]);
    expect(views.find((v) => v.name === "b")?.issues).toEqual([]);
    expect(views.find((v) => v.name === "c")?.issues).toHaveLength(1);
  });

  test("overview paints every severity and falls back for unknown ones", () => {
    const views = getModuleViews(
      mk({
        crit: { issues: [issue("critical")] },
        err: { issues: [issue("error")] },
        warn: { issues: [issue("warning")] },
        inf: { issues: [issue("info")] },
        weird: { issues: [issue("weird")] },
      }),
    );
    const out = renderOverview(views);
    expect(out).toContain("crit");
    expect(out).toContain("weird");
    expect(renderOverview([])).toBe("");
  });

  test("renders locations, recommendations and unknown severities", () => {
    const view = {
      name: "m",
      issues: [
        { severity: "critical", title: "A", message: "m", location: { file: "a.ts", line: 3 } },
        { severity: "error", title: "B", message: "m", location: { file: "b.ts" }, recommendation: "fix it" },
        { severity: "warning", title: "C", message: "m", location: {} },
        { severity: "info", title: "D", message: "m" },
        { severity: "weird", title: "E", message: "m" },
      ],
    };
    const out = renderModuleIssues(view);
    expect(out).toContain("a.ts:3");
    expect(out).toContain("b.ts");
    expect(out).not.toContain("b.ts:");
    expect(out).toContain("fix it");
    expect(out).toContain("WEIRD");
    expect(out).not.toContain("more");
  });

  test("next steps cover every rule and the osv fallback step", () => {
    const names = ["image-guard", "security-guard", "config-guard", "dependency-guard", "dead-code-guard", "memory-guard", "async-guard"];
    const all = buildNextSteps(mk(Object.fromEntries(names.map((n) => [n, { issues: [issue("warning")] }]))));
    expect(all).toHaveLength(7);
    expect(all.filter((s) => s.command === "muraqib resolve")).toHaveLength(1);

    const osv = buildNextSteps(mk({ osv: { issues: [issue("error", { dependencyProblem: { package: "x" } })] } }));
    expect(osv).toEqual([expect.objectContaining({ command: "muraqib resolve" })]);

    const covered = buildNextSteps(
      mk({ "dependency-guard": { issues: [issue("error", { dependencyProblem: {} })] } }),
    );
    expect(covered).toHaveLength(1);
  });
});
