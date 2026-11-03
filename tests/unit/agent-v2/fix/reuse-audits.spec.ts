import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { AgentIssue } from "../../../../src/agent/types.js";

const audits = vi.hoisted(() => ({ count: 0 }));
vi.mock("../../../../src/agent/run-audit-for-agent.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../../src/agent/run-audit-for-agent.js")>();
  return {
    ...original,
    runAuditForAgent: (...args: Parameters<typeof original.runAuditForAgent>): ReturnType<typeof original.runAuditForAgent> => {
      audits.count += 1;
      return original.runAuditForAgent(...args);
    },
  };
});

import { runFixSession, type FixSessionResult } from "../../../../src/agent-v2/fix/session.js";
import { verifyFix, verifyFixDetailed } from "../../../../src/agent-v2/fix/verify.js";
import { collectIssues } from "../../../../src/agent-v2/planner.js";
import type { Fixer, FixMode, ProposedFix } from "../../../../src/agent-v2/fix/types.js";
import { badProject, fakeFixer, fixContent, fixOf, issue } from "./helpers.js";

const roots: string[] = [];
function project(files?: string[]): string {
  const r = badProject(files);
  roots.push(r);
  return r;
}
beforeEach(() => {
  audits.count = 0;
});
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

async function realIssues(root: string): Promise<AgentIssue[]> {
  const collected = await collectIssues(root);
  if (!collected.ok) throw new Error(collected.error);
  return collected.issues;
}

/** Fix for src/a.ts that resolves the real floating-promise issue of the bad project. */
async function realFix(root: string, noop = false): Promise<ProposedFix> {
  return fixFor(root, await realIssues(root), noop);
}
function fixFor(root: string, issues: readonly AgentIssue[], noop: boolean): ProposedFix {
  const current = readFileSync(join(root, "src/a.ts"), "utf-8");
  const content = noop ? `${current}// touched\n` : fixContent(current);
  return fixOf({ resolves: issues.filter((i) => i.file?.endsWith("a.ts") === true).map((i) => i.id), edits: [{ file: "src/a.ts", content }] });
}

describe("verifyFix baseline", () => {
  test("a given baseline skips exactly one audit and gives the same verdict (accept)", async () => {
    const root = project();
    const fix = await realFix(root);
    const baseline = await realIssues(root);
    audits.count = 0;
    const without = await verifyFix(root, fix);
    const withoutAudits = audits.count;
    audits.count = 0;
    const withBaseline = await verifyFix(root, fix, { baseline });
    expect(withBaseline).toEqual(without);
    expect(withBaseline.accepted).toBe(true);
    expect(withoutAudits).toBe(2);
    expect(audits.count).toBe(1);
  });

  test("a given baseline gives the same verdict (reject)", async () => {
    const root = project();
    const fix = await realFix(root, true);
    const baseline = await realIssues(root);
    const without = await verifyFix(root, fix);
    const withBaseline = await verifyFix(root, fix, { baseline });
    expect(without.accepted).toBe(false);
    expect(withBaseline).toEqual(without);
  });

  test("with an injected collect the baseline replaces the first call only", async () => {
    const calls: string[] = [];
    const collect = async (): Promise<AgentIssue[]> => {
      calls.push("collect");
      return [];
    };
    const target = issue("i1", "problem");
    const fix = fixOf({ resolves: ["i1"], edits: [{ file: "src/a.ts", content: "x" }] });
    const root = project();
    const outcome = await verifyFix(root, fix, { collect, baseline: [target] });
    expect(calls).toEqual(["collect"]);
    expect(outcome).toEqual({ accepted: true, resolved: 1 });
  });

  test("a stale baseline that lacks the resolved issue is ignored and the tree is re-audited", async () => {
    const root = project();
    const fix = await realFix(root);
    const stale = [issue("some-other-id", "unrelated")];
    audits.count = 0;
    const outcome = await verifyFix(root, fix, { baseline: stale });
    expect(audits.count).toBe(2);
    expect(outcome).toEqual(await verifyFix(root, fix));
  });

  test("verifyFixDetailed returns the after-fix issues, none when verification crashes", async () => {
    const root = project();
    const fix = await realFix(root);
    const detailed = await verifyFixDetailed(root, fix);
    expect(detailed.outcome.accepted).toBe(true);
    expect(detailed.after?.some((i) => i.file?.endsWith("a.ts") === true && i.code === "ASYNC_FLOATING_PROMISE")).toBe(false);
    const crash = await verifyFixDetailed(root, fixOf({ edits: [{ file: "../escape.ts", content: "x" }] }));
    expect(crash.outcome.accepted).toBe(false);
    expect(crash.after).toBeUndefined();
  });
});

/** Strips nothing: every field of the result is deterministic and independent of the temp root. */
async function run(mode: FixMode, files: string[], fixers: readonly Fixer[], reuseAudits: boolean, maxFixes?: number): Promise<{ result: FixSessionResult; files: string[]; audits: number }> {
  const root = project(files);
  audits.count = 0;
  const result = await runFixSession({ projectRoot: root, mode, fixers, approve: async () => true, reuseAudits, maxFixes });
  return { result, files: files.map((f) => readFileSync(join(root, f), "utf-8")), audits: audits.count };
}

describe("runFixSession: old and new paths decide identically", () => {
  const scenarios: { name: string; files: string[]; fixer: () => Fixer; maxFixes?: number }[] = [
    { name: "one accepted fix", files: ["src/a.ts"], fixer: () => fakeFixer() },
    { name: "two accepted fixes", files: ["src/a.ts", "src/b.ts"], fixer: () => fakeFixer() },
    { name: "maxFixes 1 of 2", files: ["src/a.ts", "src/b.ts"], fixer: () => fakeFixer(), maxFixes: 1 },
    { name: "rejected fix", files: ["src/a.ts", "src/b.ts"], fixer: () => fakeFixer({ noop: true }) },
    { name: "secret-removing fix", files: ["src/a.ts", "src/b.ts"], fixer: () => fakeFixer({ removesSecret: true }) },
    { name: "decision only", files: ["src/a.ts"], fixer: () => fakeFixer({ decision: true }) },
  ];
  for (const mode of ["propose", "apply"] as const) {
    for (const scenario of scenarios) {
      test(`${mode}: ${scenario.name}`, async () => {
        const oldPath = await run(mode, scenario.files, [scenario.fixer()], false, scenario.maxFixes);
        const newPath = await run(mode, scenario.files, [scenario.fixer()], true, scenario.maxFixes);
        expect(newPath.result).toEqual(oldPath.result);
        expect(newPath.files).toEqual(oldPath.files);
        expect(newPath.audits).toBeLessThanOrEqual(oldPath.audits);
        if (mode === "apply") expect(newPath.audits).toBe(oldPath.audits);
      });
    }
  }

  test("propose mode with reuse audits strictly less and the minimum number of times", async () => {
    const oldPath = await run("propose", ["src/a.ts", "src/b.ts"], [fakeFixer()], false);
    const newPath = await run("propose", ["src/a.ts", "src/b.ts"], [fakeFixer()], true);
    // old: 3 plans + 2 x (baseline + after); new: 1 plan + 2 x after
    expect(oldPath.audits).toBe(7);
    expect(newPath.audits).toBe(3);
    expect(newPath.result.issuesAfter).toBe(oldPath.result.issuesAfter);
  });

  test("a rejected fix in propose mode re-plans from the known issues without a new audit", async () => {
    const newPath = await run("propose", ["src/a.ts"], [fakeFixer({ noop: true })], true);
    expect(newPath.result.outcomes.map((o) => o.status)).toEqual(["rejected"]);
    // plan + verification after-fix audit only
    expect(newPath.audits).toBe(2);
  });

  test("an injected collect disables reuse (the fake audit is the only judge)", async () => {
    const root = project(["src/a.ts"]);
    audits.count = 0;
    const calls: number[] = [];
    const result = await runFixSession({
      projectRoot: root,
      mode: "propose",
      fixers: [fakeFixer()],
      verifyDeps: {
        collect: async (r) => {
          calls.push(1);
          return realIssues(r);
        },
      },
    });
    expect(result.outcomes.map((o) => o.status)).toEqual(["verified"]);
    expect(calls).toHaveLength(2);
  });
});
