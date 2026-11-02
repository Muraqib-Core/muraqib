import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import { runFixSession } from "../../../../src/agent-v2/fix/session.js";
import { GOOD_SRC, BAD_SRC, badProject, fakeFixer, hashTree, tmp } from "./helpers.js";
import { readdirSync } from "node:fs";
import { tmpdir } from "node:os";

const savedTmp = process.env["TMPDIR"];
let privateTmp = "";
const roots: string[] = [];
beforeAll(() => {
  privateTmp = tmp("agent-v2-session-tmp-");
  process.env["TMPDIR"] = privateTmp;
});
afterAll(() => {
  if (savedTmp === undefined) delete process.env["TMPDIR"];
  else process.env["TMPDIR"] = savedTmp;
  rmSync(privateTmp, { recursive: true, force: true });
});
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});
function project(files?: string[]): string {
  const r = badProject(files);
  roots.push(r);
  return r;
}
const read = (root: string, f: string): string => readFileSync(join(root, f), "utf-8");

describe("propose mode", () => {
  test("returns a patch and leaves the real project untouched", async () => {
    const root = project();
    const before = hashTree(root);
    const result = await runFixSession({ projectRoot: root, mode: "propose", fixers: [fakeFixer()] });
    expect(result.ok).toBe(true);
    expect(result.outcomes.map((o) => o.status)).toEqual(["verified"]);
    expect(result.patch).toContain("+  await f();");
    expect(result.patch).toContain("src/a.ts");
    expect(hashTree(root)).toBe(before);
    expect(readdirSync(tmpdir()).filter((n) => n.startsWith("muraqib-agent-copy-"))).toEqual([]);
  });

  test("a removesSecret fix is verified with a note and kept out of the patch", async () => {
    const root = project();
    const before = hashTree(root);
    const result = await runFixSession({ projectRoot: root, mode: "propose", fixers: [fakeFixer({ removesSecret: true })] });
    expect(result.outcomes).toHaveLength(1);
    expect(result.outcomes[0]?.status).toBe("verified");
    expect(result.outcomes[0]?.note).toContain("apply mode");
    expect(result.patch).toBe("");
    expect(hashTree(root)).toBe(before);
  });

  test("a rejected fix is reported once and the loop terminates", async () => {
    const root = project();
    const result = await runFixSession({ projectRoot: root, mode: "propose", fixers: [fakeFixer({ noop: true })] });
    expect(result.ok).toBe(true);
    expect(result.outcomes).toHaveLength(1);
    expect(result.outcomes[0]?.status).toBe("rejected");
    expect(result.outcomes[0]?.verification?.accepted).toBe(false);
    expect(result.patch).toBe("");
  });

  test("decisions from the fixer are surfaced and produce no patch", async () => {
    const root = project();
    const result = await runFixSession({ projectRoot: root, mode: "propose", fixers: [fakeFixer({ decision: true })] });
    expect(result.outcomes).toEqual([]);
    expect(result.decisions).toHaveLength(1);
    expect(result.decisions[0]?.question).toBe("which?");
    expect(result.patch).toBe("");
  });

  test("maxFixes is honored", async () => {
    const root = project(["src/a.ts", "src/b.ts"]);
    const limited = await runFixSession({ projectRoot: root, mode: "propose", fixers: [fakeFixer()], maxFixes: 1 });
    expect(limited.outcomes.filter((o) => o.status === "verified")).toHaveLength(1);
    const zero = await runFixSession({ projectRoot: root, mode: "propose", fixers: [fakeFixer()], maxFixes: 0 });
    expect(zero.outcomes).toEqual([]);
    const all = await runFixSession({ projectRoot: root, mode: "propose", fixers: [fakeFixer()] });
    expect(all.outcomes.filter((o) => o.status === "verified")).toHaveLength(2);
    expect(all.patch).toContain("src/a.ts");
    expect(all.patch).toContain("src/b.ts");
  });

  test("no fixers means no outcomes", async () => {
    const root = project();
    const result = await runFixSession({ projectRoot: root, mode: "propose", fixers: [] });
    expect(result.ok).toBe(true);
    expect(result.outcomes).toEqual([]);
    expect(result.patch).toBe("");
  });
});

describe("apply mode", () => {
  test("approve true edits the real project", async () => {
    const root = project();
    const result = await runFixSession({ projectRoot: root, mode: "apply", fixers: [fakeFixer()], approve: async () => true });
    expect(result.outcomes.map((o) => o.status)).toEqual(["applied"]);
    expect(read(root, "src/a.ts")).toBe(GOOD_SRC);
    expect(result.patch).toBe("");
  });

  test("approve false declines and leaves the file unchanged", async () => {
    const root = project();
    const result = await runFixSession({ projectRoot: root, mode: "apply", fixers: [fakeFixer()], approve: async () => false });
    expect(result.outcomes.map((o) => o.status)).toEqual(["declined"]);
    expect(read(root, "src/a.ts")).toBe(BAD_SRC);
  });

  test("no approve callback declines", async () => {
    const root = project();
    const result = await runFixSession({ projectRoot: root, mode: "apply", fixers: [fakeFixer()] });
    expect(result.outcomes.map((o) => o.status)).toEqual(["declined"]);
    expect(read(root, "src/a.ts")).toBe(BAD_SRC);
  });

  test("a rejected fix is never offered for approval or applied", async () => {
    const root = project();
    let asked = 0;
    const result = await runFixSession({ projectRoot: root, mode: "apply", fixers: [fakeFixer({ noop: true })], approve: async () => { asked += 1; return true; } });
    expect(result.outcomes.map((o) => o.status)).toEqual(["rejected"]);
    expect(asked).toBe(0);
    expect(read(root, "src/a.ts")).toBe(BAD_SRC);
  });
});
