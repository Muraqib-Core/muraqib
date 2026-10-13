import { describe, expect, it } from "vitest";
import { MAX_PATH_LENGTH, isSafePathString, isWebviewToHostMessage, parseWebviewMessage } from "../src/core/messages.js";

describe("parseWebviewMessage", () => {
  it("accepts the simple messages and drops extra fields", () => {
    expect(parseWebviewMessage({ type: "ready", extra: 1 })).toEqual({ type: "ready" });
    expect(parseWebviewMessage({ type: "runAudit" })).toEqual({ type: "runAudit" });
    expect(parseWebviewMessage({ type: "showDocs" })).toEqual({ type: "showDocs" });
  });

  it("accepts openFile with and without a position", () => {
    expect(parseWebviewMessage({ type: "openFile", file: "src/a.ts" })).toEqual({ type: "openFile", file: "src/a.ts" });
    expect(parseWebviewMessage({ type: "openFile", file: "src/a.ts", line: 3, column: 9, evil: true })).toEqual({
      type: "openFile",
      file: "src/a.ts",
      line: 3,
      column: 9,
    });
  });

  it.each([
    undefined,
    null,
    "runAudit",
    42,
    [],
    {},
    { type: 1 },
    { type: "unknown" },
    { type: "__proto__" },
    { type: "openFile" },
    { type: "openFile", file: "" },
    { type: "openFile", file: 5 },
    { type: "openFile", file: "a\0b" },
    { type: "openFile", file: "x".repeat(MAX_PATH_LENGTH + 1) },
    { type: "openFile", file: "a.ts", line: "3" },
    { type: "openFile", file: "a.ts", line: 0 },
    { type: "openFile", file: "a.ts", line: -1 },
    { type: "openFile", file: "a.ts", line: 1.5 },
    { type: "openFile", file: "a.ts", line: Number.NaN },
    { type: "openFile", file: "a.ts", line: Infinity },
    { type: "openFile", file: "a.ts", line: 1e9 },
    { type: "openFile", file: "a.ts", column: 0 },
    { type: "openFile", file: "a.ts", line: null },
  ])("rejects malformed input %j", (input) => {
    expect(parseWebviewMessage(input)).toBeUndefined();
    expect(isWebviewToHostMessage(input)).toBe(false);
  });

  it("type guard accepts valid messages", () => {
    expect(isWebviewToHostMessage({ type: "ready" })).toBe(true);
  });
});

describe("isSafePathString", () => {
  it("requires a non-empty string without NUL within the length limit", () => {
    expect(isSafePathString("a")).toBe(true);
    expect(isSafePathString("")).toBe(false);
    expect(isSafePathString("a\0")).toBe(false);
    expect(isSafePathString(undefined)).toBe(false);
  });
});
