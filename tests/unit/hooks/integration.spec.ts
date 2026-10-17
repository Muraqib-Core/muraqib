import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { runHookCli } from "../../../src/hooks/cli.js";
import { git, initRepo, isolateGit, write } from "./git-fixture.js";

/**
 * End to end: real `git commit` / `git push`, the generated hook script, and the real TypeScript hook
 * runner (through tsx), exactly as a developer's repository would run them.
 */
const SOURCE_CLI = path.resolve(import.meta.dirname, "../../../src/hooks/cli.ts");
const TSX = pathToFileURL(createRequire(import.meta.url).resolve("tsx/esm")).href;
const STRIPE = `sk_live_${"aB3".repeat(8)}`;

let restore: () => void;
beforeAll(() => {
  restore = isolateGit();
});
afterAll(() => restore());

function repoWithMuraqib(): string {
  const repo = initRepo();
  const bin = path.join(repo, "node_modules/.bin/muraqib");
  write(repo, "node_modules/.bin/muraqib", `#!/bin/sh\nexec "${process.execPath}" --import "${TSX}" -e 'import("${pathToFileURL(SOURCE_CLI).href}").then((m) => m.runHookCli(process.argv.slice(2))).then((code) => { process.exitCode = code; })' -- "$@"\n`);
  fs.chmodSync(bin, 0o755);
  return repo;
}

function commit(repo: string, env: Record<string, string> = {}, ...extra: string[]): { status: number | null; stderr: string } {
  const result = spawnSync("git", ["commit", "-q", "-m", "change", ...extra], { cwd: repo, encoding: "utf8", env: { ...process.env, ...env } });
  return { status: result.status, stderr: result.stderr };
}

async function silently<T>(run: () => Promise<T>): Promise<T> {
  const log = console.log;
  console.log = () => undefined;
  try {
    return await run();
  } finally {
    console.log = log;
  }
}

describe.skipIf(process.platform === "win32")("installed git hooks", () => {
  test("a commit that stages a secret is blocked, and a clean one goes through", async () => {
    const repo = repoWithMuraqib();
    await silently(() => runHookCli(["install"], repo));

    write(repo, "clean.ts", "export const a = 1;\n");
    git(repo, "add", "clean.ts");
    expect(commit(repo).status).toBe(0);

    write(repo, "leak.ts", `export const key = "${STRIPE}";\n`);
    git(repo, "add", "leak.ts");
    const blocked = commit(repo);
    expect(blocked.status).not.toBe(0);
    expect(blocked.stderr).toContain("muraqib: commit blocked, 1 secret(s) in the staged changes");
    expect(blocked.stderr).toContain("leak.ts:1");
    expect(blocked.stderr).not.toContain(STRIPE);
    expect(git(repo, "log", "--oneline").trim().split("\n")).toHaveLength(1);
  }, 30_000);

  test("--no-verify and MURAQIB_SKIP_HOOKS bypass the hook", async () => {
    const repo = repoWithMuraqib();
    await silently(() => runHookCli(["install"], repo));
    write(repo, "leak.ts", `export const key = "${STRIPE}";\n`);
    git(repo, "add", "leak.ts");
    expect(commit(repo, {}, "--no-verify").status).toBe(0);

    write(repo, "leak2.ts", `export const key = "${STRIPE}";\n`);
    git(repo, "add", "leak2.ts");
    expect(commit(repo, { MURAQIB_SKIP_HOOKS: "1" }).status).toBe(0);
  }, 30_000);

  test("an existing hook keeps running next to Muraqib's block, and survives uninstall", async () => {
    const repo = repoWithMuraqib();
    const legacy = `#!/bin/sh\necho ran >> "${path.join(repo, "legacy.log")}"\n`;
    write(repo, ".git/hooks/pre-commit", legacy);
    fs.chmodSync(path.join(repo, ".git/hooks/pre-commit"), 0o755);
    await silently(() => runHookCli(["install"], repo));

    write(repo, "a.ts", "export const a = 1;\n");
    git(repo, "add", "a.ts");
    expect(commit(repo).status).toBe(0);
    expect(fs.readFileSync(path.join(repo, "legacy.log"), "utf8")).toBe("ran\n");

    await silently(() => runHookCli(["uninstall"], repo));
    expect(fs.readFileSync(path.join(repo, ".git/hooks/pre-commit"), "utf8")).toBe(legacy);

    write(repo, "leak.ts", `export const key = "${STRIPE}";\n`);
    git(repo, "add", "leak.ts");
    expect(commit(repo).status).toBe(0);
  }, 30_000);

  test("works through core.hooksPath", async () => {
    const repo = repoWithMuraqib();
    git(repo, "config", "core.hooksPath", ".githooks");
    await silently(() => runHookCli(["install"], repo));
    write(repo, "leak.ts", `export const key = "${STRIPE}";\n`);
    git(repo, "add", "leak.ts");
    expect(commit(repo).status).not.toBe(0);
    expect(fs.existsSync(path.join(repo, ".githooks/pre-commit"))).toBe(true);
  }, 30_000);

  test("works as a Husky hook (run by `sh -e`, as Husky does)", async () => {
    const repo = repoWithMuraqib();
    git(repo, "config", "core.hooksPath", ".husky/_");
    write(repo, ".husky/pre-commit", "echo lint-staged-ran\n");
    // Husky v9's generated stub: runs the user's hook with `sh -e`.
    write(repo, ".husky/_/pre-commit", `#!/usr/bin/env sh\nsh -e "$(dirname "$0")/../pre-commit" "$@"\n`);
    fs.chmodSync(path.join(repo, ".husky/_/pre-commit"), 0o755);
    await silently(() => runHookCli(["install"], repo));

    write(repo, "ok.ts", "export const a = 1;\n");
    git(repo, "add", "ok.ts");
    expect(commit(repo).status).toBe(0);

    write(repo, "leak.ts", `export const key = "${STRIPE}";\n`);
    git(repo, "add", "leak.ts");
    expect(commit(repo).status).not.toBe(0);
  }, 30_000);

  test("the pre-push hook is installed only on request and blocks the push on exit status 1", async () => {
    const repo = initRepo();
    const remote = fs.mkdtempSync(path.join(path.dirname(repo), "remote-"));
    git(remote, "init", "-q", "--bare");
    git(repo, "remote", "add", "origin", remote);
    write(repo, "a.txt", "x\n");
    git(repo, "add", "-A");
    git(repo, "commit", "-qm", "base");
    // A stand-in binary: records its arguments and exits with the status in ./status.
    write(repo, "node_modules/.bin/muraqib", `#!/bin/sh\necho "$@" > "${repo}/args.log"\nexit $(cat "${repo}/status")\n`);
    fs.chmodSync(path.join(repo, "node_modules/.bin/muraqib"), 0o755);

    await silently(() => runHookCli(["install"], repo));
    expect(fs.existsSync(path.join(repo, ".git/hooks/pre-push"))).toBe(false);
    await silently(() => runHookCli(["install", "--pre-push"], repo));

    const push = (): number | null => spawnSync("git", ["push", "-q", "origin", "HEAD:refs/heads/main"], { cwd: repo, encoding: "utf8" }).status;
    write(repo, "status", "1");
    expect(push()).not.toBe(0);
    expect(fs.readFileSync(path.join(repo, "args.log"), "utf8")).toContain("hook run pre-push origin");
    write(repo, "status", "3");
    expect(push()).toBe(0);
  }, 30_000);
});
