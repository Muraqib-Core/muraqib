import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { runEvalCli } from "../../../src/agent-v2/eval-cli.js";

let out: string[];
let err: string[];

beforeEach(() => {
  out = [];
  err = [];
  vi.spyOn(process.stdout, "write").mockImplementation((c: string | Uint8Array) => (out.push(String(c)), true));
  vi.spyOn(process.stderr, "write").mockImplementation((c: string | Uint8Array) => (err.push(String(c)), true));
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("muraqib-agent eval", () => {
  test("--help exits 0", async () => {
    expect(await runEvalCli(["--help"])).toBe(0);
    expect(out.join("")).toContain("Usage: muraqib-agent eval");
  });

  test("unknown argument exits 2", async () => {
    expect(await runEvalCli(["--bogus"])).toBe(2);
    expect(err.join("")).toContain("Unknown argument: --bogus");
  });

  test("runs the built-in projects: no wrong fix, exit 0, text and JSON output", async () => {
    expect(await runEvalCli([])).toBe(0);
    expect(out.join("")).toContain("Wrongly fixed");
    out.length = 0;
    expect(await runEvalCli(["--json"])).toBe(0);
    const parsed = JSON.parse(out.join("")) as { total: { metrics: { wronglyFixed: number; planted: number } }; gemini: { measured: boolean } };
    expect(parsed.total.metrics.wronglyFixed).toBe(0);
    expect(parsed.total.metrics.planted).toBeGreaterThan(0);
    expect(parsed.gemini.measured).toBe(false);
  });
});
