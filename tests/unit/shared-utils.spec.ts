import { describe, expect, test } from "vitest";
import { extractEnvErrors, getArg, toMessage } from "../../src/shared/utils.js";

describe("toMessage", () => {
  test("reads Error messages and stringifies everything else", () => {
    expect(toMessage(new Error("e"))).toBe("e");
    expect(toMessage("s")).toBe("s");
    expect(toMessage(42)).toBe("42");
  });
});

describe("extractEnvErrors", () => {
  test("formats Muraqib custom errors using path or field", () => {
    const err = {
      isMuraqibCustom: true,
      errors: [{ path: "A", message: "bad" }, { field: "B" }, {}],
    };
    expect(extractEnvErrors(err)).toEqual(["A: bad", "B: invalid", "unknown: invalid"]);
  });

  test("formats zod-style issues with array paths", () => {
    const err = { issues: [{ path: ["a", "b"], message: "x" }, { message: "y" }] };
    expect(extractEnvErrors(err)).toEqual(["a.b: x", "unknown: y"]);
  });

  test("formats plain errors arrays", () => {
    const err = { errors: [{ path: ["p"], message: "m" }, { field: "f" }, {}] };
    expect(extractEnvErrors(err)).toEqual(["p: m", "f: invalid", "unknown: invalid"]);
  });

  test("falls back to the message for anything else", () => {
    expect(extractEnvErrors(new Error("plain"))).toEqual(["plain"]);
    expect(extractEnvErrors(null)).toEqual(["null"]);
    expect(extractEnvErrors({ isMuraqibCustom: false, errors: "no" })).toEqual(["[object Object]"]);
  });
});

describe("getArg", () => {
  test("returns the value following a flag", () => {
    expect(getArg(["--a", "1"], "--a")).toBe("1");
  });

  test("returns undefined when the flag is missing, last, or followed by a flag", () => {
    expect(getArg(["--b"], "--a")).toBeUndefined();
    expect(getArg(["--a"], "--a")).toBeUndefined();
    expect(getArg(["--a", "--b"], "--a")).toBeUndefined();
  });
});
