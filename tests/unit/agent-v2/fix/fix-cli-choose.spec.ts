import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { runAgentCli } from "../../../../src/agent-v2/cli.js";
import { copyProject } from "../../../../src/agent-v2/fix/project-copy.js";
import { createPlan } from "../../../../src/agent-v2/planner.js";
import { badProject, hashTree, put, tmp, BAD_SRC } from "./helpers.js";

let out: string[];
let err: string[];
const roots: string[] = [];

beforeEach(() => {
  out = [];
  err = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
    out.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
    err.push(String(chunk));
    return true;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

function track(root: string): string {
  roots.push(root);
  return root;
}

/** The auto-fixable floating-promise issue ids of a project, keyed by file. */
async function issueIds(root: string): Promise<Map<string, string>> {
  const plan = await createPlan({ projectRoot: root });
  const ids = new Map<string, string>();
  for (const step of plan.steps) if (step.fixClass === "floating-promise" && step.file !== undefined) ids.set(step.file, step.issueId);
  return ids;
}

function fixArgs(root: string, patch: string, ...choose: string[]): string[] {
  return ["fix", "--project", root, "--out", patch, ...choose.flatMap((c) => ["--choose", c])];
}

/** `git apply --check` (and the real apply) of the patch against a copy of the project. */
function applyToCopy(root: string, patchFile: string): string {
  const copy = copyProject(root);
  roots.push(copy);
  execFileSync("git", ["-c", "core.autocrlf=false", "apply", "--check", patchFile], { cwd: copy });
  execFileSync("git", ["-c", "core.autocrlf=false", "apply", patchFile], { cwd: copy });
  return copy;
}

describe("fix --choose", () => {
  test.each([
    ["async", ["async function g()", "await f();"], ".catch("],
    ["catch", [".catch((error: unknown)"], "async function g()"],
  ] as const)("=%s writes the matching patch", async (key, expected, forbidden) => {
    const root = track(badProject());
    const patch = join(track(tmp("agent-v2-choose-")), "x.patch");
    const before = hashTree(root);
    const id = (await issueIds(root)).get("src/a.ts");
    expect(id).toBeDefined();
    expect(await runAgentCli(fixArgs(root, patch, `${id ?? ""}=${key}`))).toBe(0);
    expect(out.join("")).toContain("[verified]");
    const text = readFileSync(patch, "utf-8");
    for (const piece of expected) expect(text).toContain(piece);
    expect(text).not.toContain(forbidden);
    const copy = applyToCopy(root, patch);
    expect(readFileSync(join(copy, "src/a.ts"), "utf-8")).toContain(key === "async" ? "await f();" : ".catch(");
    expect(hashTree(root)).toBe(before);
  });

  test("without --choose the decision is reported and no patch is written", async () => {
    const root = track(badProject());
    const patch = join(track(tmp("agent-v2-choose-")), "x.patch");
    expect(await runAgentCli(fixArgs(root, patch))).toBe(0);
    expect(out.join("")).toContain("Decision needed");
    expect(existsSync(patch)).toBe(false);
  });

  test("an invalid option key is reported as skipped: no crash, no patch, project untouched", async () => {
    const root = track(badProject());
    const patch = join(track(tmp("agent-v2-choose-")), "x.patch");
    const before = hashTree(root);
    const id = (await issueIds(root)).get("src/a.ts") ?? "";
    expect(await runAgentCli(fixArgs(root, patch, `${id}=bogus`))).toBe(0);
    const text = out.join("");
    expect(text).toContain(`Skipped ${id}`);
    expect(text).toContain('unknown choice "bogus"');
    expect(text).toContain("async, catch");
    expect(existsSync(patch)).toBe(false);
    expect(hashTree(root)).toBe(before);
  });

  test("an id that matches no issue changes nothing; the real decision stays open", async () => {
    const root = track(badProject());
    const patch = join(track(tmp("agent-v2-choose-")), "x.patch");
    const before = hashTree(root);
    const id = (await issueIds(root)).get("src/a.ts") ?? "";
    expect(await runAgentCli(fixArgs(root, patch, "ffffffffffff=async"))).toBe(0);
    const text = out.join("");
    expect(text).toContain(`Decision needed for ${id}`);
    expect(err.join("")).toBe("");
    expect(existsSync(patch)).toBe(false);
    expect(hashTree(root)).toBe(before);
  });

  test("answers survive when several issues exist, including a stray unknown id", async () => {
    const root = track(badProject(["src/a.ts", "src/b.ts", "src/c.ts"]));
    put(root, "src/d.ts", BAD_SRC);
    const patch = join(track(tmp("agent-v2-choose-")), "x.patch");
    const ids = await issueIds(root);
    const pick = (file: string): string => ids.get(file) ?? "";
    expect(ids.size).toBe(4);
    const code = await runAgentCli(fixArgs(root, patch, `${pick("src/a.ts")}=async`, `${pick("src/b.ts")}=catch`, "000000000000=async", `${pick("src/c.ts")}=nope`));
    expect(code).toBe(0);
    const text = out.join("");
    expect(text).toContain(`Skipped ${pick("src/c.ts")}`);
    expect(text).toContain(`Decision needed for ${pick("src/d.ts")}`);
    const copy = applyToCopy(root, patch);
    const read = (f: string): string => readFileSync(join(copy, f), "utf-8");
    expect(read("src/a.ts")).toContain("async function g()");
    expect(read("src/a.ts")).toContain("await f();");
    expect(read("src/b.ts")).toContain(".catch(");
    expect(read("src/b.ts")).not.toContain("async function g()");
    expect(read("src/c.ts")).toBe(BAD_SRC);
    expect(read("src/d.ts")).toBe(BAD_SRC);
  });

  test("a malformed --choose is a usage error (exit 2) and writes nothing", async () => {
    const root = track(badProject());
    const patch = join(track(tmp("agent-v2-choose-")), "x.patch");
    expect(await runAgentCli(["fix", "--project", root, "--out", patch, "--choose", "no-equals-sign"])).toBe(2);
    expect(err.join("")).toContain("--choose needs <id>=<option>");
    expect(existsSync(patch)).toBe(false);
  });
});
