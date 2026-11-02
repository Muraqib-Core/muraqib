import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { runAgentCli } from "../../../src/agent-v2/cli.js";

let out: string[];
let err: string[];

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
});

describe("muraqib-agent argument handling", () => {
  test("--help prints usage and exits 0", async () => {
    expect(await runAgentCli(["--help"])).toBe(0);
    expect(out.join("")).toContain("Usage: muraqib-agent plan");
  });

  test("no command prints usage and exits 2", async () => {
    expect(await runAgentCli([])).toBe(2);
    expect(out.join("")).toContain("Usage:");
  });

  test("unknown command exits 2", async () => {
    expect(await runAgentCli(["fix"])).toBe(2);
    expect(err.join("")).toContain("Unknown command: fix");
  });

  test.each([
    [["plan", "--project"], "--project needs a path"],
    [["plan", "--module"], "--module needs a name"],
    [["plan", "--max-steps", "x"], "--max-steps needs a non-negative integer"],
    [["plan", "--max-steps", "-1"], "--max-steps needs a non-negative integer"],
    [["plan", "--bogus"], "Unknown argument: --bogus"],
  ])("%j exits 2 with a clear message", async (args, message) => {
    expect(await runAgentCli(args)).toBe(2);
    expect(err.join("")).toContain(message);
  });

  test("a missing project directory exits 2", async () => {
    expect(await runAgentCli(["plan", "--project", "/definitely/not/here"])).toBe(2);
    expect(err.join("")).toContain("Project path not found");
  });
});
