import { rmSync } from "node:fs";
import { afterEach, describe, expect, test, vi } from "vitest";
import { formatFixReport } from "../../../../src/agent-v2/fix/report.js";
import { runFixSession } from "../../../../src/agent-v2/fix/session.js";
import { formatPrDescription } from "../../../../src/agent-v2/pr-description.js";
import { createPlan } from "../../../../src/agent-v2/planner.js";
import { nodeCmd } from "./command-helpers.js";
import { badProject, fakeFixer, hashTree } from "./helpers.js";

// Real audits are slower on Windows than the 5 s default allows.
vi.setConfig({ testTimeout: 120_000 });

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});
function project(files?: string[]): string {
  const r = badProject(files);
  roots.push(r);
  return r;
}
/** Passes while src/a.ts has no await, fails once the fix added one. */
const NO_AWAIT = nodeCmd("process.exit(require('fs').readFileSync('src/a.ts','utf8').includes('await')?1:0)");
const ALWAYS_OK = nodeCmd("process.exit(0)");
const ALWAYS_FAIL = nodeCmd("process.exit(1)");

describe("runFixSession with verifyCommands", () => {
  test("a fix that breaks the command is rejected and the project is untouched", async () => {
    const root = project();
    const before = hashTree(root);
    const result = await runFixSession({ projectRoot: root, mode: "propose", fixers: [fakeFixer()], verifyCommands: [NO_AWAIT] });
    const [outcome] = result.outcomes;
    expect(outcome?.status).toBe("rejected");
    expect(outcome?.note).toBe(`verify command failed: ${NO_AWAIT} (exit 1)`);
    expect(outcome?.verification?.accepted).toBe(false);
    expect(result.patch).toBe("");
    expect(hashTree(root)).toBe(before);
    expect(formatFixReport(result)).toContain("[rejected] fix src/a.ts");
  });

  test("passing commands keep the fix and are listed in report and PR text", async () => {
    const root = project();
    const result = await runFixSession({ projectRoot: root, mode: "propose", fixers: [fakeFixer()], verifyCommands: [ALWAYS_OK] });
    expect(result.outcomes[0]?.status).toBe("verified");
    expect(result.outcomes[0]?.commandCheck).toEqual({ passed: [ALWAYS_OK], warnings: [] });
    expect(result.patch).toContain("+  await f();");
    expect(formatFixReport(result)).toContain(`verify commands passed: ${ALWAYS_OK}`);
    const plan = await createPlan({ projectRoot: root });
    expect(formatPrDescription(plan, result).body).toContain(`Verify commands run on the fixed copy and passed: \`${ALWAYS_OK}\``);
  });

  test("a baseline that already fails is a warning, not a rejection", async () => {
    const root = project();
    const result = await runFixSession({ projectRoot: root, mode: "propose", fixers: [fakeFixer()], verifyCommands: [ALWAYS_FAIL] });
    expect(result.outcomes[0]?.status).toBe("verified");
    expect(formatFixReport(result)).toContain("WARNING: verify-cmd baseline already failing - not used");
  });

  test("without verifyCommands the output has no command lines", async () => {
    const root = project();
    const result = await runFixSession({ projectRoot: root, mode: "propose", fixers: [fakeFixer()] });
    expect(result.outcomes[0]?.commandCheck).toBeUndefined();
    const empty = await runFixSession({ projectRoot: root, mode: "propose", fixers: [fakeFixer()], verifyCommands: [] });
    expect(empty.outcomes[0]?.commandCheck).toBeUndefined();
    expect(formatFixReport(result)).not.toMatch(/verify/i);
    const plan = await createPlan({ projectRoot: root });
    expect(formatPrDescription(plan, result).body).not.toMatch(/Verify commands/);
  });

  test("apply mode rejects before asking the user", async () => {
    const root = project();
    const approve = vi.fn(async () => true);
    const result = await runFixSession({ projectRoot: root, mode: "apply", fixers: [fakeFixer()], approve, verifyCommands: [NO_AWAIT] });
    expect(result.outcomes[0]?.status).toBe("rejected");
    expect(approve).not.toHaveBeenCalled();
  });
});
