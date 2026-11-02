import { rmSync } from "node:fs";
import { afterEach, describe, expect, test, vi } from "vitest";
import { runFixSession } from "../../../../src/agent-v2/fix/session.js";
import { BAD_SRC, badProject, fakeFixer, hashTree } from "./helpers.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("../../../../src/agent-v2/planner.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../../src/agent-v2/planner.js")>();
  return {
    ...original,
    createPlan: async () => ({ schemaVersion: 1, projectRoot: "x", verdict: "fail", ok: false, error: "audit exploded", summary: { total: 0, autoFixable: 0, manual: 0, byFixClass: {} }, steps: [] }),
  };
});

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

describe("plan failure", () => {
  test.each(["propose", "apply"] as const)("%s mode: ok false with the error, nothing changed", async (mode) => {
    const root = badProject();
    roots.push(root);
    const before = hashTree(root);
    const result = await runFixSession({ projectRoot: root, mode, fixers: [fakeFixer()], approve: async () => true });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("audit exploded");
    expect(result.outcomes).toEqual([]);
    expect(result.patch).toBe("");
    expect(hashTree(root)).toBe(before);
    expect(readFileSync(join(root, "src/a.ts"), "utf-8")).toBe(BAD_SRC);
  });
});
