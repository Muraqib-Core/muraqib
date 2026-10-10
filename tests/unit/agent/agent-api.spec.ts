import { beforeEach, describe, expect, test, vi } from "vitest";

const { collect } = vi.hoisted(() => ({ collect: vi.fn() }));
vi.mock("../../../src/orchestrator/collect-results.js", () => ({ collectAuditResults: collect }));

import {
  AGENT_TOOL_DEFINITIONS,
  buildAgentReport,
  executeAgentTool,
  getSystemContext,
  runAuditForAgent,
} from "../../../src/agent/index.js";
import type { AuditIssue, AuditResult } from "../../../src/core/types.js";

const issue = (over: Partial<AuditIssue>): AuditIssue => ({
  code: "X001",
  severity: "warning",
  title: "t",
  message: "m",
  tags: ["b", "a"],
  ...over,
});
const result = (module: string, issues: AuditIssue[]): AuditResult => ({
  status: issues.length ? "issues" : "ok",
  module,
  issues,
  message: "",
  timestamp: 1,
  duration: 1,
});

beforeEach(() => {
  collect.mockReset();
});

describe("buildAgentReport", () => {
  const results = [
    result("security", [
      issue({ severity: "info", location: { file: "z.ts", line: 3 } }),
      issue({ severity: "critical", code: "S1", location: { file: "a.ts", line: 9, column: 2 }, recommendation: "fix it" }),
    ]),
    result("memory", [issue({ severity: "warning" })]),
    result("async", []),
  ];

  test("sorts by severity, counts, and strips volatile fields", () => {
    const report = buildAgentReport("/p", results);
    expect(report.issues.map((i) => i.severity)).toEqual(["critical", "warning", "info"]);
    expect(report.summary).toEqual({ total: 3, critical: 1, error: 0, warning: 1, info: 1 });
    expect(report.modules.map((m) => m.name)).toEqual(["async", "memory", "security"]);
    expect(report.verdict).toBe("fail");
    const first = report.issues[0]!;
    expect(first).toMatchObject({ file: "a.ts", line: 9, column: 2, recommendation: "fix it", tags: ["a", "b"] });
    expect(JSON.stringify(report)).not.toMatch(/timestamp|duration/);
  });

  test("is deterministic regardless of input order", () => {
    const a = buildAgentReport("/p", results);
    const b = buildAgentReport("/p", [...results].reverse());
    expect(b).toEqual(a);
    expect(new Set(a.issues.map((i) => i.id)).size).toBe(3);
  });

  test("verdict passes on warnings unless failOnWarning", () => {
    const warn = [result("m", [issue({})])];
    expect(buildAgentReport("/p", warn).verdict).toBe("pass");
    expect(buildAgentReport("/p", warn, { failOnWarning: true }).verdict).toBe("fail");
    expect(buildAgentReport("/p", []).verdict).toBe("pass");
  });

  test("maxIssues truncates and reports the remainder", () => {
    const report = buildAgentReport("/p", results, { maxIssues: 1 });
    expect(report.issues).toHaveLength(1);
    expect(report.truncated).toBe(2);
    expect(buildAgentReport("/p", results, { maxIssues: 0 }).issues).toEqual([]);
  });

  test("includes the AI advisory only when present", () => {
    expect(buildAgentReport("/p", [], {}, "advice").aiAdvisory).toBe("advice");
    expect("aiAdvisory" in buildAgentReport("/p", [])).toBe(false);
  });
});

describe("runAuditForAgent", () => {
  test("collects with scan flags and returns a report", async () => {
    collect.mockResolvedValue({ results: [result("m", [issue({ severity: "error" })])], aiAdvisory: null });
    const report = await runAuditForAgent({ projectRoot: "/proj", osv: true, modules: ["m"] });
    expect(collect).toHaveBeenCalledWith(expect.objectContaining({ projectRoot: "/proj", scan: true, modules: ["m"] }));
    expect(report).toMatchObject({ ok: true, verdict: "fail", projectRoot: "/proj" });
  });

  test("does not enable the scan layer by default", async () => {
    collect.mockResolvedValue({ results: [], aiAdvisory: null });
    await runAuditForAgent({ projectRoot: "/p" });
    expect(collect).toHaveBeenCalledWith(expect.objectContaining({ scan: false }));
  });

  test("never throws: failures become ok:false", async () => {
    collect.mockImplementation(async () => {
      throw new Error("boom");
    });
    expect(await runAuditForAgent({ projectRoot: "/p" })).toMatchObject({ ok: false, verdict: "fail", error: "boom" });
  });
});

describe("system context and tools", () => {
  test("context is static and JSON-serialisable", () => {
    const ctx = getSystemContext();
    expect(JSON.parse(JSON.stringify(ctx))).toEqual(ctx);
    expect(ctx.modules.length).toBeGreaterThan(0);
    expect(Object.keys(ctx.severities)).toEqual(["critical", "error", "warning", "info"]);
  });

  test("tool definitions carry valid JSON-schema inputs", () => {
    expect(AGENT_TOOL_DEFINITIONS.map((t) => t.name)).toEqual(["muraqib_audit", "muraqib_context"]);
    for (const tool of AGENT_TOOL_DEFINITIONS) expect(tool.inputSchema.type).toBe("object");
  });

  test("executeAgentTool validates input and dispatches", async () => {
    collect.mockResolvedValue({ results: [], aiAdvisory: null });
    await executeAgentTool("muraqib_audit", {
      projectRoot: "/x", modules: ["a", 5], securityUrl: "http://u", osv: true, docker: "yes", maxIssues: 2.5, failOnWarning: true,
    });
    expect(collect).toHaveBeenCalledWith(expect.objectContaining({ projectRoot: "/x", modules: ["a"], securityUrl: "http://u", scan: true }));
    await executeAgentTool("muraqib_audit", "garbage");
    expect(await executeAgentTool("muraqib_context", {})).toEqual(getSystemContext());
    expect(await executeAgentTool("nope", {})).toEqual({ ok: false, error: "Unknown tool: nope" });
    await executeAgentTool("muraqib_audit", { maxIssues: 3 });
  });
});
