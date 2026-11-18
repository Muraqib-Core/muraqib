import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const question = vi.fn();
const close = vi.fn();
vi.mock("node:readline/promises", () => ({
  createInterface: (): unknown => ({ question: (q: string): unknown => question(q), close: (): void => close() }),
}));

import { runFixCli } from "../../../../src/agent-v2/fix-cli.js";
import { badProject, tmp } from "./helpers.js";

let out = "";
let err = "";
const roots: string[] = [];
const ttyDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf-8" });
}
const ASYNC_BAD = "async function f(){}\nasync function g(){\n  f();\n}\n";
const ASYNC_GOOD = "async function f(){}\nasync function g(){\n  await f();\n}\n";

function gitProject(): string {
  const root = badProject();
  roots.push(root);
  writeFileSync(join(root, "src/a.ts"), ASYNC_BAD);
  git(root, "init", "-q");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "init");
  return root;
}

beforeEach(() => {
  out = "";
  err = "";
  question.mockReset();
  close.mockReset();
  vi.spyOn(process.stdout, "write").mockImplementation(((s: string | Uint8Array) => {
    out += String(s);
    return true;
  }) as never);
  vi.spyOn(process.stderr, "write").mockImplementation(((s: string | Uint8Array) => {
    err += String(s);
    return true;
  }) as never);
});
afterEach(() => {
  vi.restoreAllMocks();
  if (ttyDescriptor === undefined) Reflect.deleteProperty(process.stdin, "isTTY");
  else Object.defineProperty(process.stdin, "isTTY", ttyDescriptor);
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

describe("fix propose with real fixers", () => {
  test("writes the patch to --out and reports it", async () => {
    const root = badProject();
    writeFileSync(join(root, "src/a.ts"), ASYNC_BAD);
    const outDir = tmp("agent-v2-cli-flow-");
    roots.push(root, outDir);
    const patch = join(outDir, "fix.patch");
    expect(await runFixCli(["--project", root, "--out", patch, "--max-fixes", "5"])).toBe(0);
    expect(existsSync(patch)).toBe(true);
    expect(readFileSync(patch, "utf-8")).toContain("await f()");
    expect(out).toContain("Muraqib agent fix (propose)");
    expect(out).toContain(`Patch written to ${patch}`);
    expect(readFileSync(join(root, "src/a.ts"), "utf-8")).not.toContain("await");
  });
});

describe("fix --apply", () => {
  test("happy path: approved fix is written on a new branch", async () => {
    const root = gitProject();
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    question.mockResolvedValue(" yes ");
    expect(await runFixCli(["--apply", "--project", root])).toBe(0);
    expect(err).toContain("Working on new branch agent/fix-");
    expect(question).toHaveBeenCalled();
    expect(String(question.mock.calls[0]?.[0])).toContain("[y/N]");
    expect(close).toHaveBeenCalled();
    expect(readFileSync(join(root, "src/a.ts"), "utf-8")).toBe(ASYNC_GOOD);
    expect(git(root, "rev-parse", "--abbrev-ref", "HEAD").trim()).toMatch(/^agent\/fix-/);
    expect(out).toContain("[applied]");
  });

  test("declined fix leaves the file unchanged", async () => {
    const root = gitProject();
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    question.mockResolvedValue("n");
    expect(await runFixCli(["--apply", "--project", root])).toBe(0);
    expect(out).toContain("[declined]");
    expect(readFileSync(join(root, "src/a.ts"), "utf-8")).toContain("  f();");
  });

  test("refused on a dirty working tree", async () => {
    const root = gitProject();
    writeFileSync(join(root, "dirty.txt"), "x");
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    expect(await runFixCli(["--apply", "--project", root])).toBe(2);
    expect(err).toContain("uncommitted changes");
    expect(question).not.toHaveBeenCalled();
  });

  test("refused outside a git repository", async () => {
    const root = badProject();
    roots.push(root);
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    // A tmp dir may sit inside no repo; if the OS tmp is inside one the reason differs but exit is still 2.
    const code = await runFixCli(["--apply", "--project", root]);
    expect(code).toBe(2);
    expect(err).toMatch(/git repository|uncommitted/);
  });
});
