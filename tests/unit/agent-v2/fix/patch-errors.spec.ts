import { beforeEach, describe, expect, test, vi } from "vitest";

const execFileSync = vi.fn();
vi.mock("node:child_process", () => ({ execFileSync: (...a: unknown[]): unknown => execFileSync(...a) }));

import { makePatch } from "../../../../src/agent-v2/fix/patch.js";
import { put, tmp } from "./helpers.js";

beforeEach(() => {
  execFileSync.mockReset();
});

function failWith(error: unknown): void {
  execFileSync.mockImplementation(() => {
    throw error;
  });
}

describe("makePatch git failures", () => {
  const a = tmp("agent-v2-patch-a-");
  const b = tmp("agent-v2-patch-b-");
  put(a, "x.ts", "1\n");
  put(b, "x.ts", "2\n");

  test("exit status 1 returns the diff from stdout", () => {
    failWith({ status: 1, stdout: "DIFF" });
    expect(makePatch(a, b, ["x.ts"])).toBe("DIFF");
  });
  test("status 1 without string stdout returns empty", () => {
    failWith({ status: 1, stdout: Buffer.from("x") });
    expect(makePatch(a, b, ["x.ts"])).toBe("");
  });
  test("other status (git missing / crash) returns empty", () => {
    failWith({ status: 128, stdout: "x" });
    expect(makePatch(a, b, ["x.ts"])).toBe("");
    failWith(new Error("ENOENT"));
    expect(makePatch(a, b, ["x.ts"])).toBe("");
  });
  test("identical folders: git success returns its stdout", () => {
    execFileSync.mockReturnValue("");
    expect(makePatch(a, b, ["missing.ts"])).toBe("");
  });
});
