import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { blockStart } from "../../../src/hooks/hook-script.js";
import { installHooks, resolveHooksLocation, uninstallHooks } from "../../../src/hooks/install.js";
import { git, initRepo, isolateGit, write } from "./git-fixture.js";

let restore: () => void;
beforeAll(() => {
  restore = isolateGit();
});
afterAll(() => restore());

const read = (repo: string, file: string): string => fs.readFileSync(path.join(repo, file), "utf8");
const exists = (repo: string, file: string): boolean => fs.existsSync(path.join(repo, file));
const isExecutable = (repo: string, file: string): boolean => (fs.statSync(path.join(repo, file)).mode & 0o111) !== 0;

describe("resolveHooksLocation", () => {
  test("defaults to .git/hooks", () => {
    const repo = initRepo();
    expect(resolveHooksLocation(repo)).toEqual({ gitRoot: repo, dir: path.join(repo, ".git", "hooks"), kind: "git" });
  });

  test("works from a subdirectory", () => {
    const repo = initRepo();
    fs.mkdirSync(path.join(repo, "packages/app"), { recursive: true });
    expect(resolveHooksLocation(path.join(repo, "packages/app")).gitRoot).toBe(repo);
  });

  test("follows a relative core.hooksPath (relative to the repository root)", () => {
    const repo = initRepo();
    git(repo, "config", "core.hooksPath", ".githooks");
    expect(resolveHooksLocation(repo)).toEqual({ gitRoot: repo, dir: path.join(repo, ".githooks"), kind: "hooksPath" });
  });

  test("follows an absolute core.hooksPath", () => {
    const repo = initRepo();
    const shared = fs.mkdtempSync(path.join(path.dirname(repo), "shared-hooks-"));
    git(repo, "config", "core.hooksPath", shared);
    expect(resolveHooksLocation(repo)).toMatchObject({ dir: shared, kind: "hooksPath" });
  });

  test("Husky v9 (core.hooksPath=.husky/_) resolves to the editable .husky directory", () => {
    const repo = initRepo();
    git(repo, "config", "core.hooksPath", ".husky/_");
    expect(resolveHooksLocation(repo)).toEqual({ gitRoot: repo, dir: path.join(repo, ".husky"), kind: "husky" });
  });

  test("Husky v4-v8 (core.hooksPath=.husky) uses that directory", () => {
    const repo = initRepo();
    git(repo, "config", "core.hooksPath", ".husky");
    expect(resolveHooksLocation(repo)).toMatchObject({ dir: path.join(repo, ".husky"), kind: "husky" });
  });

  test("a linked worktree uses the shared hooks directory", () => {
    const repo = initRepo();
    write(repo, "a.txt", "x");
    git(repo, "add", "-A");
    git(repo, "commit", "-qm", "base");
    const tree = path.join(path.dirname(repo), `${path.basename(repo)}-wt`);
    git(repo, "worktree", "add", "-q", tree, "-b", "wt");
    expect(resolveHooksLocation(tree).dir).toBe(path.join(repo, ".git", "hooks"));
  });

  test("throws a clear error outside a git repository", () => {
    const outside = fs.mkdtempSync(path.join(path.dirname(initRepo()), "not-a-repo-"));
    expect(() => resolveHooksLocation(outside)).toThrow("Not a git repository");
  });
});

describe("installHooks", () => {
  test("creates an executable pre-commit hook only, by default", () => {
    const repo = initRepo();
    const { outcomes } = installHooks(repo);
    expect(outcomes.map((o) => [o.hook, o.action])).toEqual([["pre-commit", "created"]]);
    expect(read(repo, ".git/hooks/pre-commit")).toContain(blockStart("pre-commit"));
    expect(isExecutable(repo, ".git/hooks/pre-commit")).toBe(process.platform === "win32" ? isExecutable(repo, ".git/hooks/pre-commit") : true);
    expect(exists(repo, ".git/hooks/pre-push")).toBe(false);
  });

  test("--pre-push opts in to the heavier hook as well", () => {
    const repo = initRepo();
    const { outcomes } = installHooks(repo, { prePush: true });
    expect(outcomes.map((o) => o.hook)).toEqual(["pre-commit", "pre-push"]);
    expect(read(repo, ".git/hooks/pre-push")).toContain("hook run pre-push");
  });

  test("never destroys an existing hook: it keeps the file and adds one marked block", () => {
    const repo = initRepo();
    const original = "#!/bin/sh\nnpx lint-staged\n";
    write(repo, ".git/hooks/pre-commit", original);
    fs.chmodSync(path.join(repo, ".git/hooks/pre-commit"), 0o755);
    expect(installHooks(repo).outcomes[0]?.action).toBe("appended");
    const after = read(repo, ".git/hooks/pre-commit");
    expect(after).toContain("npx lint-staged\n");
    expect(after.startsWith("#!/bin/sh\n# >>> muraqib pre-commit >>>")).toBe(true);
  });

  test("makes an existing non-executable hook executable so git runs it", () => {
    const repo = initRepo();
    write(repo, ".git/hooks/pre-commit", "#!/bin/sh\necho hi\n");
    fs.chmodSync(path.join(repo, ".git/hooks/pre-commit"), 0o644);
    installHooks(repo);
    if (process.platform !== "win32") expect(isExecutable(repo, ".git/hooks/pre-commit")).toBe(true);
  });

  test("is idempotent", () => {
    const repo = initRepo();
    installHooks(repo, { prePush: true });
    const before = read(repo, ".git/hooks/pre-commit");
    const second = installHooks(repo, { prePush: true });
    expect(second.outcomes.map((o) => o.action)).toEqual(["unchanged", "unchanged"]);
    expect(read(repo, ".git/hooks/pre-commit")).toBe(before);
  });

  test("respects core.hooksPath and leaves .git/hooks alone", () => {
    const repo = initRepo();
    git(repo, "config", "core.hooksPath", ".githooks");
    installHooks(repo);
    expect(exists(repo, ".githooks/pre-commit")).toBe(true);
    expect(exists(repo, ".git/hooks/pre-commit")).toBe(false);
  });

  test("Husky v9: edits .husky/pre-commit, not the generated .husky/_ stubs", () => {
    const repo = initRepo();
    git(repo, "config", "core.hooksPath", ".husky/_");
    write(repo, ".husky/_/pre-commit", "generated stub\n");
    write(repo, ".husky/pre-commit", "npx lint-staged\n");
    installHooks(repo);
    expect(read(repo, ".husky/_/pre-commit")).toBe("generated stub\n");
    expect(read(repo, ".husky/pre-commit")).toContain(blockStart("pre-commit"));
    expect(read(repo, ".husky/pre-commit")).toContain("npx lint-staged\n");
  });

  test("Husky v9 with no user hook yet creates .husky/pre-commit", () => {
    const repo = initRepo();
    git(repo, "config", "core.hooksPath", ".husky/_");
    installHooks(repo);
    expect(exists(repo, ".husky/pre-commit")).toBe(true);
  });

  test("skips a hook written in another language instead of corrupting it", () => {
    const repo = initRepo();
    const node = "#!/usr/bin/env node\nconsole.log('hi');\n";
    write(repo, ".git/hooks/pre-commit", node);
    const { outcomes } = installHooks(repo);
    expect(outcomes[0]).toMatchObject({ action: "skipped", reason: expect.stringContaining("not a shell script") });
    expect(read(repo, ".git/hooks/pre-commit")).toBe(node);
  });

  test("refuses to touch a hook with a malformed Muraqib block", () => {
    const repo = initRepo();
    write(repo, ".git/hooks/pre-commit", `#!/bin/sh\n${blockStart("pre-commit")}\nhand edited\n`);
    expect(() => installHooks(repo)).toThrow(/closing marker/);
  });

  test("a project in a monorepo subfolder points the hook at its own node_modules binary", () => {
    const repo = initRepo();
    const project = path.join(repo, "packages", "app");
    write(repo, "packages/app/node_modules/.bin/muraqib", "#!/bin/sh\n");
    installHooks(project);
    expect(read(repo, ".git/hooks/pre-commit")).toContain('"./packages/app/node_modules/.bin/muraqib"');
  });

  test("throws outside a git repository", () => {
    expect(() => installHooks(fs.mkdtempSync(path.join(path.dirname(initRepo()), "plain-")))).toThrow("Not a git repository");
  });
});

describe("uninstallHooks", () => {
  test("removes a hook Muraqib created", () => {
    const repo = initRepo();
    installHooks(repo, { prePush: true });
    const { outcomes } = uninstallHooks(repo);
    expect(outcomes.map((o) => [o.hook, o.action])).toEqual([["pre-commit", "deleted"], ["pre-push", "deleted"]]);
    expect(exists(repo, ".git/hooks/pre-commit")).toBe(false);
    expect(exists(repo, ".git/hooks/pre-push")).toBe(false);
  });

  test("restores a pre-existing hook byte for byte", () => {
    const repo = initRepo();
    const original = "#!/bin/sh\nnpx lint-staged\necho done\n";
    write(repo, ".git/hooks/pre-commit", original);
    installHooks(repo);
    expect(uninstallHooks(repo).outcomes[0]?.action).toBe("removed");
    expect(read(repo, ".git/hooks/pre-commit")).toBe(original);
  });

  test("restores a Husky hook byte for byte", () => {
    const repo = initRepo();
    git(repo, "config", "core.hooksPath", ".husky/_");
    const original = "npx lint-staged\n";
    write(repo, ".husky/pre-commit", original);
    installHooks(repo);
    uninstallHooks(repo);
    expect(read(repo, ".husky/pre-commit")).toBe(original);
  });

  test("--pre-push removes only the pre-push block", () => {
    const repo = initRepo();
    installHooks(repo, { prePush: true });
    uninstallHooks(repo, { prePush: true });
    expect(exists(repo, ".git/hooks/pre-commit")).toBe(true);
    expect(exists(repo, ".git/hooks/pre-push")).toBe(false);
  });

  test("reports hooks that were not installed", () => {
    const repo = initRepo();
    expect(uninstallHooks(repo).outcomes.map((o) => [o.hook, o.action])).toEqual([["pre-commit", "absent"], ["pre-push", "absent"]]);
  });

  test("cleans blocks left in .git/hooks after core.hooksPath was set later", () => {
    const repo = initRepo();
    installHooks(repo);
    git(repo, "config", "core.hooksPath", ".githooks");
    const { outcomes } = uninstallHooks(repo);
    expect(outcomes.find((o) => o.hook === "pre-commit")?.action).toBe("deleted");
    expect(exists(repo, ".git/hooks/pre-commit")).toBe(false);
  });

  test("leaves other tools' hooks untouched", () => {
    const repo = initRepo();
    write(repo, ".git/hooks/pre-commit", "#!/bin/sh\necho mine\n");
    write(repo, ".git/hooks/commit-msg", "#!/bin/sh\necho msg\n");
    installHooks(repo);
    uninstallHooks(repo);
    expect(read(repo, ".git/hooks/commit-msg")).toBe("#!/bin/sh\necho msg\n");
  });
});
