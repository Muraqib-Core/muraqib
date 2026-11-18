import { execFileSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { createFixBranch } from "../../../../src/agent-v2/fix/apply.js";
import { put, tmp } from "./helpers.js";

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});
function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8" }).trim();
}
function repo(): string {
  const root = tmp("agent-v2-gitrepo-");
  roots.push(root);
  git(root, ["init", "-q"]);
  git(root, ["config", "user.name", "Test User"]);
  git(root, ["config", "user.email", "test@example.com"]);
  git(root, ["config", "commit.gpgsign", "false"]);
  put(root, "a.txt", "hello\n");
  git(root, ["add", "."]);
  git(root, ["commit", "-q", "-m", "init"]);
  return root;
}

describe("createFixBranch", () => {
  test("not a git repository", () => {
    const root = tmp("agent-v2-nogit-");
    roots.push(root);
    const r = createFixBranch(root);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("git repository");
  });

  test("dirty tree is refused and the branch stays", () => {
    const root = repo();
    const branch = git(root, ["rev-parse", "--abbrev-ref", "HEAD"]);
    writeFileSync(join(root, "a.txt"), "changed\n");
    const r = createFixBranch(root);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("uncommitted");
    expect(git(root, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe(branch);
  });

  test("untracked files also count as dirty", () => {
    const root = repo();
    writeFileSync(join(root, "new.txt"), "x");
    expect(createFixBranch(root).ok).toBe(false);
  });

  test("clean repo gets a new agent/fix-<timestamp> branch checked out", () => {
    const root = repo();
    const previous = git(root, ["rev-parse", "--abbrev-ref", "HEAD"]);
    const r = createFixBranch(root);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.branch).toMatch(/^agent\/fix-\d{14}$/);
      expect(r.previous).toBe(previous);
      expect(git(root, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe(r.branch);
    }
  });

  test("uses the supplied clock for the timestamp", () => {
    const root = repo();
    const r = createFixBranch(root, new Date("2026-03-04T05:06:07.000Z"));
    expect(r).toMatchObject({ ok: true, branch: "agent/fix-20260304050607" });
  });

  test("a second call with the same timestamp fails cleanly instead of throwing", () => {
    const root = repo();
    const when = new Date("2026-03-04T05:06:07.000Z");
    expect(createFixBranch(root, when).ok).toBe(true);
    git(root, ["switch", "-q", "-"]);
    const again = createFixBranch(root, when);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.reason).toContain("could not create a branch");
  });
});
