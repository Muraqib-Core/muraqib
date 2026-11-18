import { describe, expect, test } from "vitest";
import type { AgentIssue, AgentSeverity } from "../../../src/agent/types.js";
import { classifyIssue, rankIssues } from "../../../src/agent-v2/planner.js";

const mk = (over: Partial<AgentIssue> & { id: string }): AgentIssue => ({
  module: "other",
  code: "X",
  severity: "warning",
  title: "t",
  message: "m",
  tags: [],
  ...over,
});

const ids = (issues: AgentIssue[], max?: number): string[] => rankIssues(issues, max).map((s) => s.issueId);

describe("classifyIssue", () => {
  test("maps async-guard floating promise codes", () => {
    expect(classifyIssue(mk({ id: "a", module: "async-guard", code: "ASYNC_FLOATING_PROMISE" }))).toBe("floating-promise");
    expect(classifyIssue(mk({ id: "a", module: "async-guard", code: "ASYNC_MISSING_AWAIT" }))).toBe("floating-promise");
  });
  test("other async-guard codes are manual", () => {
    expect(classifyIssue(mk({ id: "a", module: "async-guard", code: "ASYNC_OTHER" }))).toBe("manual");
  });
  test("maps secret and env modules", () => {
    expect(classifyIssue(mk({ id: "a", module: "agent-v2-secrets" }))).toBe("hardcoded-secret");
    expect(classifyIssue(mk({ id: "a", module: "agent-v2-env" }))).toBe("env-documentation");
  });
  test("unknown module is manual", () => {
    expect(classifyIssue(mk({ id: "a" }))).toBe("manual");
  });
});

describe("rankIssues", () => {
  test("severity first", () => {
    const sev = (s: AgentSeverity, id: string): AgentIssue => mk({ id, severity: s });
    expect(ids([sev("info", "i"), sev("warning", "w"), sev("critical", "c"), sev("error", "e")])).toEqual(["c", "e", "w", "i"]);
  });

  test("autoFixable before manual at equal severity", () => {
    expect(ids([mk({ id: "m" }), mk({ id: "f", module: "agent-v2-env" })])).toEqual(["f", "m"]);
  });

  test("severity beats autoFixable", () => {
    expect(ids([mk({ id: "f", module: "agent-v2-env" }), mk({ id: "m", severity: "error" })])).toEqual(["m", "f"]);
  });

  test("location tier: src/ before other before tests/", () => {
    const out = ids([
      mk({ id: "t", file: "tests/a.ts" }),
      mk({ id: "o", file: "scripts/a.ts" }),
      mk({ id: "s", file: "src/z.ts" }),
    ]);
    expect(out).toEqual(["s", "o", "t"]);
  });

  test("then file, line, id", () => {
    const out = ids([
      mk({ id: "d", file: "src/b.ts", line: 1 }),
      mk({ id: "c", file: "src/a.ts", line: 9 }),
      mk({ id: "b", file: "src/a.ts", line: 2 }),
      mk({ id: "a", file: "src/a.ts", line: 2 }),
    ]);
    expect(out).toEqual(["a", "b", "c", "d"]);
  });

  test("dedupes by id keeping the first", () => {
    const steps = rankIssues([mk({ id: "x", title: "first" }), mk({ id: "x", title: "second" })]);
    expect(steps).toHaveLength(1);
    expect(steps[0]?.title).toBe("first");
  });

  test("maxSteps caps after ranking; ranks are 1-based", () => {
    const steps = rankIssues([mk({ id: "w" }), mk({ id: "c", severity: "critical" }), mk({ id: "e", severity: "error" })], 2);
    expect(steps.map((s) => [s.rank, s.issueId])).toEqual([[1, "c"], [2, "e"]]);
    expect(rankIssues([mk({ id: "a" })], 0)).toEqual([]);
  });

  test("is independent of input order", () => {
    const list = [mk({ id: "a", file: "src/a.ts" }), mk({ id: "b", severity: "error" }), mk({ id: "c", file: "tests/c.ts" })];
    expect(rankIssues(list)).toEqual(rankIssues([...list].reverse()));
  });
});
