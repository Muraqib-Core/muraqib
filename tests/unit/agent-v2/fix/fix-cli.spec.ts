import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { runFixCli } from "../../../../src/agent-v2/fix-cli.js";
import { badProject, tmp } from "./helpers.js";

let out = "";
let err = "";
const roots: string[] = [];
const ttyDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");

beforeEach(() => {
  out = "";
  err = "";
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
function project(): string {
  const r = badProject();
  roots.push(r);
  return r;
}

describe("fix usage and argument errors", () => {
  test("--help and -h exit 0 with usage on stdout", async () => {
    expect(await runFixCli(["--help"])).toBe(0);
    expect(out).toContain("Usage: muraqib-agent fix");
    out = "";
    expect(await runFixCli(["-h"])).toBe(0);
  });

  test.each([
    [["--bogus"], "Unknown argument"],
    [["--choose", "nodelimiter"], "--choose needs"],
    [["--choose"], "--choose needs"],
    [["--max-fixes", "-1"], "--max-fixes needs"],
    [["--max-fixes", "abc"], "--max-fixes needs"],
    [["--max-fixes", "1.5"], "--max-fixes needs"],
    [["--project"], "--project needs"],
    [["--out"], "--out needs"],
  ])("bad args %j exit 2", async (args, msg) => {
    expect(await runFixCli(args)).toBe(2);
    expect(err).toContain(msg);
  });

  test("missing project exits 2", async () => {
    expect(await runFixCli(["--project", join(tmp("agent-v2-cli-"), "nope")])).toBe(2);
    expect(err).toContain("not found");
  });

  test("--apply without a TTY exits 2", async () => {
    const root = project();
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
    expect(await runFixCli(["--apply", "--project", root])).toBe(2);
    expect(err).toContain("interactive terminal");
  });
});

describe("fix --dry-run with the default (empty) registry", () => {
  test("exits 0, reports no fixes and writes no patch", async () => {
    const root = project();
    const outDir = tmp("agent-v2-cli-out-");
    roots.push(outDir);
    const patch = join(outDir, "x.patch");
    expect(await runFixCli(["--dry-run", "--project", root, "--out", patch, "--choose", "id=opt", "--max-fixes", "3"])).toBe(0);
    expect(out).toContain("No fixes were produced");
    expect(existsSync(patch)).toBe(false);
    expect(readdirSync(outDir)).toEqual([]);
  });
});
