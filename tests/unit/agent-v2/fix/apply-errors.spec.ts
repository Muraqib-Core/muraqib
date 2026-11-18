import { beforeEach, describe, expect, test, vi } from "vitest";

const execFileSync = vi.fn();
vi.mock("node:child_process", () => ({ execFileSync: (...a: unknown[]): unknown => execFileSync(...a) }));

import { createFixBranch } from "../../../../src/agent-v2/fix/apply.js";

beforeEach(() => {
  execFileSync.mockReset();
});

function script(steps: (string | Error | unknown)[]): void {
  for (const step of steps) {
    execFileSync.mockImplementationOnce(() => {
      if (typeof step === "string") return step;
      throw step;
    });
  }
}

describe("createFixBranch error reporting", () => {
  test("not a repository", () => {
    script([new Error("nope")]);
    const r = createFixBranch("/x");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("git repository");
  });

  test("switch fails with an Error: first message line only", () => {
    script(["true", "", "main\n", new Error("fatal: first\nsecond")]);
    const r = createFixBranch("/x");
    expect(r).toEqual({ ok: false, reason: "could not create a branch: fatal: first" });
  });

  test("switch fails with a non-Error value", () => {
    script(["true", "", "main\n", { not: "an error" }]);
    const r = createFixBranch("/x");
    expect(r).toEqual({ ok: false, reason: "could not create a branch: git error" });
  });

  test("success builds a timestamped branch name", () => {
    script(["true", "", "main\n", ""]);
    const r = createFixBranch("/x", new Date("2026-01-02T03:04:05Z"));
    expect(r).toEqual({ ok: true, branch: "agent/fix-20260102030405", previous: "main" });
  });
});
