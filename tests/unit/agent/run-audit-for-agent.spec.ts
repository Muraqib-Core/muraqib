import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditIssue, AuditResult } from "../../../src/core/types.js";

const collect = vi.hoisted(() => vi.fn());
vi.mock("../../../src/orchestrator/collect-results.js", () => ({ collectAuditResults: collect }));

import { buildAgentReport, runAuditForAgent } from "../../../src/agent/run-audit-for-agent.js";

const issue = (over: Partial<AuditIssue> = {}): AuditIssue => ({
  code: "X",
  severity: "warning",
  title: "t",
  message: "m",
  tags: [],
  ...over,
});

const result = (module: string, issues: AuditIssue[], extra: Partial<AuditResult> = {}): AuditResult => ({
  status: issues.length ? "issues" : "ok",
  module,
  issues,
  message: "",
  timestamp: 0,
  duration: 0,
  ...extra,
});

beforeEach(() => collect.mockReset());

describe("buildAgentReport", () => {
  it("passes for an empty result set", () => {
    const report = buildAgentReport("/p", []);
    expect(report).toMatchObject({ ok: true, verdict: "pass", exitCode: 0, truncated: 0, issues: [] });
    expect(report).not.toHaveProperty("aiAdvisory");
  });

  it("maps optional issue fields only when present and sorts tags", () => {
    const [full] = buildAgentReport("/p", [
      result("m", [issue({ location: { file: "a.ts", line: 3, column: 4 }, recommendation: "fix", tags: ["b", "a"] })]),
    ]).issues;
    expect(full).toMatchObject({ file: "a.ts", line: 3, column: 4, recommendation: "fix", tags: ["a", "b"] });
    const [bare] = buildAgentReport("/p", [result("m", [issue()])]).issues;
    expect(bare).not.toHaveProperty("file");
    expect(bare).not.toHaveProperty("line");
    expect(bare).not.toHaveProperty("column");
    expect(bare).not.toHaveProperty("recommendation");
    expect(bare?.id).toMatch(/^[0-9a-f]{12}$/);
  });

  it("orders by severity, module, file, line then id", () => {
    const report = buildAgentReport("/p", [
      result("b", [issue({ severity: "warning", location: { file: "z.ts", line: 1 } })]),
      result("a", [
        issue({ severity: "warning", location: { file: "z.ts", line: 9 } }),
        issue({ severity: "warning", location: { file: "z.ts", line: 2 } }),
        issue({ severity: "warning", location: { file: "a.ts" } }),
        issue({ severity: "warning", code: "Y", message: "other" }),
        issue({ severity: "critical" }),
        issue({ severity: "info" }),
      ]),
    ]);
    expect(report.issues.map((i) => `${i.severity}:${i.module}:${i.file ?? ""}:${i.line ?? 0}`)).toEqual([
      "critical:a::0",
      "warning:a::0",
      "warning:a:a.ts:0",
      "warning:a:z.ts:2",
      "warning:a:z.ts:9",
      "warning:b:z.ts:1",
      "info:a::0",
    ]);
    expect(report.summary).toEqual({ total: 7, critical: 1, error: 0, warning: 5, info: 1 });
  });

  it("breaks full ties by id deterministically", () => {
    const a = buildAgentReport("/p", [result("m", [issue({ message: "one" }), issue({ message: "two" })])]);
    const b = buildAgentReport("/p", [result("m", [issue({ message: "two" }), issue({ message: "one" })])]);
    expect(a.issues.map((i) => i.id)).toEqual(b.issues.map((i) => i.id));
  });

  it("truncates with maxIssues and ignores negative limits", () => {
    const results = [result("m", [issue({ message: "1" }), issue({ message: "2" }), issue({ message: "3" })])];
    expect(buildAgentReport("/p", results, { maxIssues: 1 })).toMatchObject({ truncated: 2 });
    expect(buildAgentReport("/p", results, { maxIssues: 1 }).issues).toHaveLength(1);
    expect(buildAgentReport("/p", results, { maxIssues: 0 }).issues).toHaveLength(0);
    expect(buildAgentReport("/p", results, { maxIssues: -1 })).toMatchObject({ truncated: 0 });
    expect(buildAgentReport("/p", results, { maxIssues: 99 })).toMatchObject({ truncated: 0 });
  });

  it("derives verdict from errors, failOnWarning and scan failures", () => {
    expect(buildAgentReport("/p", [result("m", [issue({ severity: "error" })])])).toMatchObject({ verdict: "fail", exitCode: 1, ok: true });
    expect(buildAgentReport("/p", [result("m", [issue()])]).verdict).toBe("pass");
    expect(buildAgentReport("/p", [result("m", [issue()])], { failOnWarning: true }).exitCode).toBe(1);
    const scanFail = result("scan", [], { scan: { exitCode: 3 } as NonNullable<AuditResult["scan"]> });
    expect(buildAgentReport("/p", [scanFail])).toMatchObject({ ok: false, exitCode: 3, verdict: "fail" });
  });

  it("sorts modules by name, carries scan metadata and the AI advisory", () => {
    const scan = { exitCode: 0 } as NonNullable<AuditResult["scan"]>;
    const report = buildAgentReport("/p", [result("zeta", []), result("alpha", [], { scan })], {}, "advice");
    expect(report.modules.map((m) => m.name)).toEqual(["alpha", "zeta"]);
    expect(report.modules[0]).toHaveProperty("scan");
    expect(report.modules[1]).not.toHaveProperty("scan");
    expect(report.aiAdvisory).toBe("advice");
  });
});

describe("runAuditForAgent", () => {
  it("collects results and enables the scan layer when requested", async () => {
    collect.mockResolvedValue({ results: [result("m", [issue({ severity: "error" })])], aiAdvisory: "tip" });
    const report = await runAuditForAgent({ projectRoot: "/root", osv: true, modules: ["m"], securityUrl: "u" });
    expect(collect).toHaveBeenCalledWith(expect.objectContaining({ projectRoot: "/root", scan: true, modules: ["m"], securityUrl: "u" }));
    expect(report).toMatchObject({ projectRoot: "/root", exitCode: 1, aiAdvisory: "tip" });
  });

  it("defaults to cwd and no scan layer", async () => {
    collect.mockResolvedValue({ results: [], aiAdvisory: null });
    const report = await runAuditForAgent();
    expect(report.projectRoot).toBe(process.cwd());
    expect(collect).toHaveBeenCalledWith(expect.objectContaining({ scan: false }));
    await runAuditForAgent({ docker: true });
    expect(collect).toHaveBeenLastCalledWith(expect.objectContaining({ scan: true }));
    await runAuditForAgent({ aiAdvisory: true });
    expect(collect).toHaveBeenLastCalledWith(expect.objectContaining({ scan: true, aiAdvisory: true }));
  });

  it("never throws: errors become a failed report", async () => {
    collect.mockRejectedValueOnce(new Error("boom"));
    expect(await runAuditForAgent({ projectRoot: "/x" })).toMatchObject({ ok: false, exitCode: 3, verdict: "fail", error: "boom", issues: [] });
    collect.mockRejectedValueOnce("plain");
    expect((await runAuditForAgent()).error).toBe("plain");
  });
});
