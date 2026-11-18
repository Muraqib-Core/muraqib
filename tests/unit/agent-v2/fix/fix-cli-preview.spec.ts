import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const question = vi.fn();
vi.mock("node:readline/promises", () => ({
  createInterface: (): unknown => ({ question: (q: string): unknown => question(q), close: (): void => undefined }),
}));

import { runFixCli } from "../../../../src/agent-v2/fix-cli.js";
import { fakeSecret } from "../support.js";
import { badProject } from "./helpers.js";

const SECRET = fakeSecret();
const OTHER_SECRET = ["sk", "live", "Z9y8X7w6V5u4T3s2R1q0P9o8"].join("_");
const ASYNC_BAD = "async function f(){}\nasync function g(){\n  f();\n}\n";
const roots: string[] = [];
const ttyDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
let out = "";
let err = "";
/** stderr text captured at the moment the prompt was shown. */
let errAtPrompt = "";

function runGit(cwd: string, ...args: string[]): void {
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf-8" });
}

function repoWith(file: string, content: string): string {
  const root = badProject();
  roots.push(root);
  writeFileSync(join(root, file), content);
  runGit(root, "init", "-q");
  runGit(root, "add", "-A");
  runGit(root, "commit", "-q", "-m", "init");
  return root;
}

function answer(value: string): void {
  question.mockImplementation(() => {
    errAtPrompt = err;
    return Promise.resolve(value);
  });
}

beforeEach(() => {
  out = "";
  err = "";
  errAtPrompt = "";
  question.mockReset();
  answer("n");
  Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
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
  roots.splice(0).forEach((r) => rmSync(r, { recursive: true, force: true }));
});

describe("fix --apply diff preview", () => {
  test("prints the diff on stderr before the prompt and `n` still declines", async () => {
    const root = repoWith("src/a.ts", ASYNC_BAD);
    expect(await runFixCli(["--apply", "--project", root])).toBe(0);
    expect(question).toHaveBeenCalledTimes(1);
    expect(errAtPrompt).toContain("--- src/a.ts");
    expect(errAtPrompt).toContain("-  f();");
    expect(errAtPrompt).toContain("+  await f();");
    expect(String(question.mock.calls[0]?.[0])).toContain("[y/N]");
    expect(out).toContain("[declined]");
    expect(out).not.toContain("+  await f();");
    expect(readFileSync(join(root, "src/a.ts"), "utf-8")).toBe(ASYNC_BAD);
  });

  test("answering y applies the previewed change", async () => {
    const root = repoWith("src/a.ts", ASYNC_BAD);
    answer("y");
    expect(await runFixCli(["--apply", "--project", root])).toBe(0);
    expect(readFileSync(join(root, "src/a.ts"), "utf-8")).toContain("  await f();");
  });

  test.each(["n", "y"])("a secret fix (answer %s) never prints the removed value or a neighbouring secret", async (reply) => {
    const content = `export const stripeKey: string = "${SECRET}";\nexport const other = "${OTHER_SECRET}";\n`;
    const root = repoWith("src/config.ts", content);
    answer(reply);
    await runFixCli(["--apply", "--project", root]);
    expect(errAtPrompt).toContain("process.env.STRIPE_KEY");
    expect(errAtPrompt).toContain("content hidden because it contains a secret");
    [SECRET, OTHER_SECRET].forEach((secret) => {
      expect(out).not.toContain(secret);
      expect(err).not.toContain(secret);
    });
  });
});
