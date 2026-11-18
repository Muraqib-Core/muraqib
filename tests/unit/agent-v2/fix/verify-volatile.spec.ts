import { afterEach, describe, expect, test } from "vitest";
import { stableKey, verifyFix } from "../../../../src/agent-v2/fix/verify.js";
import type { AgentIssue } from "../../../../src/agent/types.js";
import { badProject, fixOf, issue } from "./helpers.js";
import { rmSync } from "node:fs";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((r) => rmSync(r, { recursive: true, force: true })));

const target = (): AgentIssue => issue("target", "Missing await at src/a.ts:3", { code: "ASYNC_MISSING_AWAIT", module: "async-guard" });
const heap = (percent: string): AgentIssue => {
  const reading = issue(`heap-${percent}`, `Heap fragmentation risk: ${percent}% used`, { code: "MEMORY_HEAP_FRAGMENTATION", module: "memory-guard" });
  delete reading.file; // a process-level issue has no file
  return reading;
};

describe("verification ignores live measurements in issue messages", () => {
  test("stableKey is the same for two readings of the same measurement", () => {
    expect(stableKey(heap("87.2"))).toBe(stableKey(heap("91.4")));
    expect(stableKey(heap("87.2"))).toContain("N%");
    // Different wording is still a different issue.
    expect(stableKey(issue("a", "Heap is 90% used"))).not.toBe(stableKey(issue("b", "Disk is 90% used")));
  });

  test("a correct fix is accepted although the heap reading changed between the two audits", async () => {
    const root = badProject();
    roots.push(root);
    let audits = 0;
    const collect = async (): Promise<AgentIssue[]> => {
      audits += 1;
      // 1st audit (before the fix): the target issue and a 87.2% heap reading.
      // 2nd audit (after the fix): the target is gone and the heap reading is now 91.4%.
      return audits === 1 ? [target(), heap("87.2")] : [heap("91.4")];
    };
    const out = await verifyFix(root, fixOf({ resolves: ["target"], edits: [{ file: "src/a.ts", content: "ok\n" }] }), { collect });
    expect(out.accepted).toBe(true);
  });

  test("a genuinely new issue is still rejected", async () => {
    const root = badProject();
    roots.push(root);
    let audits = 0;
    const collect = async (): Promise<AgentIssue[]> => {
      audits += 1;
      return audits === 1 ? [target(), heap("87.2")] : [heap("91.4"), issue("new", "Something else is wrong", { code: "OTHER" })];
    };
    const out = await verifyFix(root, fixOf({ resolves: ["target"], edits: [{ file: "src/a.ts", content: "ok\n" }] }), { collect });
    expect(out.accepted).toBe(false);
    if (!out.accepted) expect(out.reason).toContain("new issues");
  });
});
