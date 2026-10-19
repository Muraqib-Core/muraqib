import { describe, expect, it } from "vitest";
import { getMuraqibNewVersionValue } from "../../../src/core/muraqib-version.js";

const get = (currentVersion: string, newVersion: string, updateStrategy: "replace" | "keep-both" = "replace"): string | null =>
  getMuraqibNewVersionValue({ currentVersion, newVersion, updateStrategy });

describe("getMuraqibNewVersionValue", () => {
  it.each(["latest", "next", "*", "beta"])('keeps the current value for dist-tag "%s"', (tag) => {
    expect(get("^1.0.0", tag)).toBe("^1.0.0");
    expect(get("^1.0.0", tag, "keep-both")).toBe("^1.0.0");
  });

  it("keeps the current value for prerelease versions", () => {
    expect(get("^1.0.0", "2.0.0-beta.1")).toBe("^1.0.0");
  });

  it.each([
    ["^1.0.0", "^1.5.0"],
    ["~1.0.0", "1.0.5"],
    ["=1.0.0", "2.0.0"],
    [">=1.0.0", "2.0.0"],
    ["<=1.0.0", "2.0.0"],
    [">1.0.0", "2.0.0"],
    ["<2.0.0", "3.0.0"],
    ["1.0.0", "2.0.0"],
  ])("preserves the prefix of %s", (current, next) => {
    const prefix = /^(\^|~|>=|<=|>|<|=)?/.exec(current)?.[0] ?? "";
    const bare = next.replace(/^[^\d]*/, "");
    expect(get(current, next)).toBe(`${prefix}${bare}`);
  });

  it("does not treat x or * as a range prefix", () => {
    expect(get("1.x", "2.0.0")).toBe("2.0.0");
    expect(get("*", "2.0.0")).toBe("*");
  });

  it("keeps only the first comparator prefix for compound ranges", () => {
    expect(get(">=1.0.0 <2", "2.3.0")).toBe(">=2.3.0");
    expect(get("^1.0.0 || ^2.0.0", "3.0.0")).toBe("^3.0.0");
    expect(get("1.0.0 - 2.0.0", "3.0.0")).toBe("3.0.0");
  });

  it("keeps the current value when it is already >= the new version", () => {
    expect(get("^2.0.0", "1.0.0")).toBe("^2.0.0");
    expect(get("^2.0.0", "2.0.0")).toBe("^2.0.0");
  });

  it("keep-both appends the new spec with the same prefix", () => {
    expect(get("^1.0.0", "2.0.0", "keep-both")).toBe("^1.0.0 || ^2.0.0");
  });

  it("returns non-string input untouched", () => {
    expect(getMuraqibNewVersionValue({ currentVersion: undefined as never, newVersion: "1.0.0", updateStrategy: "replace" })).toBeUndefined();
  });
});
