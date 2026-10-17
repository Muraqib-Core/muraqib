import fs from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { runHookCli } from "../../../src/hooks/cli.js";
import { runCli } from "../../../src/cli/index.js";
import { git, initRepo, isolateGit, write } from "./git-fixture.js";

let restore: () => void;
let out: string[];
let errors: string[];

beforeAll(() => {
  restore = isolateGit();
});
afterAll(() => restore());
beforeEach(() => {
  out = [];
  errors = [];
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => void out.push(args.join(" ")));
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => void errors.push(args.join(" ")));
});
afterEach(() => vi.restoreAllMocks());

const printed = (): string => out.join("\n");

describe("muraqib hook install / uninstall", () => {
  test("install reports what it did and advertises the opt-in pre-push hook", async () => {
    const repo = initRepo();
    expect(await runHookCli(["install"], repo)).toBe(0);
    expect(printed()).toContain("Hooks directory: .git/hooks (default git hooks directory)");
    expect(printed()).toContain("pre-commit: created .git/hooks/pre-commit");
    expect(printed()).toContain("muraqib hook install --pre-push");
    expect(fs.existsSync(path.join(repo, ".git/hooks/pre-push"))).toBe(false);
  });

  test("install --pre-push adds the pre-push hook and drops the hint", async () => {
    const repo = initRepo();
    expect(await runHookCli(["install", "--pre-push"], repo)).toBe(0);
    expect(printed()).toContain("pre-push: created .git/hooks/pre-push");
    expect(printed()).not.toContain("opt-in");
  });

  test("names the hooks location kind for core.hooksPath and Husky", async () => {
    const repo = initRepo();
    git(repo, "config", "core.hooksPath", ".husky/_");
    await runHookCli(["install"], repo);
    expect(printed()).toContain("Hooks directory: .husky (Husky)");
  });

  test("-p selects the repository", async () => {
    const repo = initRepo();
    expect(await runHookCli(["install", "-p", repo], path.dirname(repo))).toBe(0);
    expect(fs.existsSync(path.join(repo, ".git/hooks/pre-commit"))).toBe(true);
  });

  test("install exits 1 when a hook cannot be edited safely", async () => {
    const repo = initRepo();
    write(repo, ".git/hooks/pre-commit", "#!/usr/bin/env node\n");
    expect(await runHookCli(["install"], repo)).toBe(1);
    expect(printed()).toContain("! pre-commit: skipped");
  });

  test("uninstall removes the hooks and says so", async () => {
    const repo = initRepo();
    await runHookCli(["install", "--pre-push"], repo);
    out = [];
    expect(await runHookCli(["uninstall"], repo)).toBe(0);
    expect(printed()).toContain("pre-commit: deleted");
    expect(printed()).toContain("pre-push: deleted");
  });

  test("outside a repository it explains and exits 1", async () => {
    const plain = fs.mkdtempSync(path.join(path.dirname(initRepo()), "plain-"));
    expect(await runHookCli(["install"], plain)).toBe(1);
    expect(errors.join("\n")).toContain("Not a git repository");
  });

  test("a malformed block is an error, not a crash", async () => {
    const repo = initRepo();
    write(repo, ".git/hooks/pre-commit", "#!/bin/sh\n# >>> muraqib pre-commit >>>\n");
    expect(await runHookCli(["uninstall"], repo)).toBe(1);
    expect(errors.join("\n")).toContain("closing marker");
  });
});

describe("muraqib hook run", () => {
  test("rejects unknown hook names", async () => {
    expect(await runHookCli(["run", "post-merge"], initRepo())).toBe(1);
    expect(errors.join("\n")).toContain('Unknown hook "post-merge"');
  });

  test("pre-commit passes a clean index and blocks a staged secret", async () => {
    const repo = initRepo();
    write(repo, "a.ts", "export const a = 1;\n");
    git(repo, "add", "-A");
    expect(await runHookCli(["run", "pre-commit", "extra", "git", "args"], repo)).toBe(0);
    write(repo, "b.ts", `const key = "sk_live_${"aB3".repeat(8)}";\n`);
    git(repo, "add", "-A");
    expect(await runHookCli(["run", "pre-commit"], repo)).toBe(1);
    expect(errors.join("\n")).toContain("commit blocked");
  });
});

describe("help and routing", () => {
  test("no subcommand prints usage and fails; --help succeeds", async () => {
    expect(await runHookCli([], initRepo())).toBe(1);
    expect(await runHookCli(["--help"], initRepo())).toBe(0);
    expect(printed()).toContain("muraqib hook install [--pre-push]");
  });

  test("an unknown subcommand is rejected", async () => {
    expect(await runHookCli(["frobnicate"], initRepo())).toBe(1);
    expect(errors.join("\n")).toContain('Unknown hook command "frobnicate"');
  });

  test("the main CLI routes `hook` to the hook commands and lists them in --help", async () => {
    const repo = initRepo();
    const previous = process.cwd();
    process.chdir(repo);
    try {
      expect(await runCli(["hook", "install"])).toBe(0);
    } finally {
      process.chdir(previous);
    }
    expect(fs.existsSync(path.join(repo, ".git/hooks/pre-commit"))).toBe(true);
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    await runCli(["--help"]);
    exit.mockRestore();
    expect(printed()).toContain("hook install|uninstall");
  });
});
