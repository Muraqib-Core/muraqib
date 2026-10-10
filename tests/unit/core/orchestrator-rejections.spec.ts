import { afterEach, describe, expect, test, vi } from "vitest";
import type { AuditContext, AuditIssue, AuditResult } from "../../../src/core/types.js";

const { createAllGuards } = vi.hoisted(() => ({ createAllGuards: vi.fn() }));
vi.mock("../../../src/core/guard-factory.js", () => ({
  GuardFactory: { create: vi.fn(() => ({ createAllGuards })) },
}));

import { AuditOrchestrator } from "../../../src/core/orchestrator.js";

const context = {
  projectRoot: "/p",
  timestamp: 123,
  environment: "production",
  nodeVersion: "20",
  npmVersion: "10",
} as unknown as AuditContext;

class MemoryGuard {
  constructor(private readonly outcome: () => Promise<AuditResult>) {}
  run(): Promise<AuditResult> {
    return this.outcome();
  }
}

const okResult = (issues: AuditIssue[] = []): AuditResult => ({
  status: issues.length ? "issues" : "ok",
  module: "ok-guard",
  issues,
  message: "",
  timestamp: 0,
  duration: 0,
});

const issue = (code: string, severity: AuditIssue["severity"], tag?: string): AuditIssue => ({
  code,
  severity,
  title: code,
  message: code,
  ...(tag ? { tags: [tag] } : {}),
});

describe("AuditOrchestrator guard failures", () => {
  afterEach(() => {
    createAllGuards.mockReset();
    vi.restoreAllMocks();
  });

  test("turns a rejected guard into a GUARD_REJECTED error result", async () => {
    createAllGuards.mockReturnValue([
      new MemoryGuard(async () => okResult()),
      new MemoryGuard(async () => {
        throw new Error("guard crashed");
      }),
      new MemoryGuard(async () => {
        throw "plain failure";
      }),
    ]);
    const result = await new AuditOrchestrator(context).execute();
    expect(result.success).toBe(true);
    const rejected = result.results.filter((r) => r.status === "error");
    expect(rejected).toHaveLength(2);
    expect(rejected[0]?.module).toBe("memory");
    expect(rejected[0]?.issues[0]?.code).toBe("GUARD_REJECTED");
    expect(rejected[0]?.issues[0]?.message).toBe("guard crashed");
    expect(rejected[1]?.issues[0]?.message).toBe("plain failure");
    expect(result.summary.errors).toBe(2);
  });

  test("returns success false when guard creation throws", async () => {
    createAllGuards.mockImplementation(() => {
      throw new Error("factory broke");
    });
    const result = await new AuditOrchestrator(context).execute();
    expect(result).toMatchObject({ success: false, results: [], findings: [] });
    expect(result.summary.errors).toBe(1);
    expect(result.summary.timestamp).toBe(123);
  });

  test("converts issues to findings with module, severity and file", async () => {
    createAllGuards.mockReturnValue([
      new MemoryGuard(async () =>
        okResult([
          { ...issue("A", "critical", "sec"), location: { file: "a.ts" } },
          issue("B", "warning"),
          issue("C", "info", "perf"),
        ])
      ),
    ]);
    const result = await new AuditOrchestrator(context).execute();
    expect(result.findings).toHaveLength(3);
    const modules = result.findings.map((f) => (typeof f.source === "string" ? f.source : f.source.module));
    expect(modules).toEqual(expect.arrayContaining(["sec", "unknown", "perf"]));
  });

  test("keeps the original order when sorting by time", async () => {
    createAllGuards.mockReturnValue([
      new MemoryGuard(async () => okResult([issue("late", "info"), issue("early", "critical")])),
    ]);
    const result = await new AuditOrchestrator(context, { sortBy: "time" }).execute();
    expect(result.findings.map((f) => f.title)).toEqual(["late", "early"]);
  });

  test("sorts by module descending", async () => {
    createAllGuards.mockReturnValue([
      new MemoryGuard(async () =>
        okResult([issue("a", "info", "alpha"), issue("z", "info", "zeta"), issue("n", "info")])
      ),
    ]);
    const result = await new AuditOrchestrator(context, { sortBy: "module", sortOrder: "desc" }).execute();
    expect(result.findings.map((f) => f.title)).toEqual(["z", "a", "n"]);
  });

  test("prints a summary with the duration in ms or seconds", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const orchestrator = new AuditOrchestrator(context);
    const base = { success: true, results: [], findings: [] };
    orchestrator.printSummary({
      ...base,
      summary: { totalIssues: 0, critical: 0, errors: 0, warnings: 0, duration: 250, timestamp: 0 },
    });
    orchestrator.printSummary({
      ...base,
      summary: { totalIssues: 2, critical: 1, errors: 1, warnings: 0, duration: 2500, timestamp: 0 },
    });
    const printed = log.mock.calls.map((c) => String(c[0])).join("\n");
    expect(printed).toContain("250ms");
    expect(printed).toContain("2.50s");
    expect(printed).toContain("All audits passed");
    expect(printed).toContain("Found 2 issue(s)");
  });

  test("static create returns an orchestrator", () => {
    expect(AuditOrchestrator.create(context)).toBeInstanceOf(AuditOrchestrator);
  });
});
