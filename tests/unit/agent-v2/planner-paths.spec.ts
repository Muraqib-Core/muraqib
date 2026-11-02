import { describe, expect, test } from "vitest";
import { rankIssues } from "../../../src/agent-v2/planner.js";
import type { AgentIssue } from "../../../src/agent/types.js";

function issue(id: string, file: string): AgentIssue {
  return { id, module: "async-guard", code: "ASYNC_FLOATING_PROMISE", severity: "error", title: "t", message: "m", file, line: 1, tags: [] };
}

describe("Windows-style paths in the plan", () => {
  test("backslash paths rank like slash paths and are stored with slashes", () => {
    const steps = rankIssues([issue("a", "tests\\unit\\a.spec.ts"), issue("b", "src\\core\\b.ts"), issue("c", "lib\\c.ts")]);
    expect(steps.map((s) => s.issueId)).toEqual(["b", "c", "a"]);
    expect(steps.map((s) => s.file)).toEqual(["src/core/b.ts", "lib/c.ts", "tests/unit/a.spec.ts"]);
    expect(steps[0]?.reasons).toContain("in src/");
    expect(steps[2]?.reasons).toContain("in tests/examples/docs");
  });

  test("the same plan comes out for slash and backslash input", () => {
    const slash = rankIssues([issue("a", "src/x/b.ts"), issue("b", "src/x/a.ts")]);
    const back = rankIssues([issue("a", "src\\x\\b.ts"), issue("b", "src\\x\\a.ts")]);
    expect(back).toEqual(slash);
  });
});
