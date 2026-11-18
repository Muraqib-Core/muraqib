import { rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { FIX_USAGE, runFixCli } from "../../../../src/agent-v2/fix-cli.js";
import { badProject } from "./helpers.js";

let out = "";
let err = "";
const roots: string[] = [];

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
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

describe("fix --verify-cmd / --verify-timeout", () => {
  test("usage documents both flags", () => {
    expect(FIX_USAGE).toContain("--verify-cmd <command>");
    expect(FIX_USAGE).toContain("--verify-timeout <s>");
  });

  test.each([
    [["--verify-cmd"], "--verify-cmd needs"],
    [["--verify-cmd", ""], "--verify-cmd needs"],
    [["--verify-cmd", "   "], "--verify-cmd needs"],
    [["--verify-timeout"], "--verify-timeout needs"],
    [["--verify-timeout", "abc"], "--verify-timeout needs"],
    [["--verify-timeout", "0"], "--verify-timeout needs"],
    [["--verify-timeout", "-5"], "--verify-timeout needs"],
    [["--verify-timeout", ""], "--verify-timeout needs"],
    [["--verify-timeout", "Infinity"], "--verify-timeout needs"],
  ])("bad args %j exit 2", async (args, msg) => {
    expect(await runFixCli(args)).toBe(2);
    expect(err).toContain(msg);
    expect(err).toContain("Usage: muraqib-agent fix");
  });

  test("valid flags (repeated command, decimal timeout) are accepted", async () => {
    const root = badProject();
    roots.push(root);
    expect(await runFixCli(["--project", root, "--verify-cmd", "node -v", "--verify-cmd", "node -v", "--verify-timeout", "2.5"])).toBe(0);
    expect(out).toContain("No fixes were produced");
  });
});
