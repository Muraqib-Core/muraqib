import { describe, expect, it } from "vitest";
import { compareVersions } from "../../../src/utils/version-compare.js";

describe("compareVersions", () => {
  it("orders by major, minor, then patch", () => {
    expect(compareVersions("2.0.0", "1.9.9")).toBeGreaterThan(0);
    expect(compareVersions("1.2.0", "1.10.0")).toBeLessThan(0);
    expect(compareVersions("1.0.2", "1.0.1")).toBeGreaterThan(0);
  });

  it("returns 0 for equal versions and ignores pre-release tags", () => {
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
    expect(compareVersions("1.2.3-beta.1", "1.2.3")).toBe(0);
  });

  it("treats partial and unparsable versions leniently", () => {
    expect(compareVersions("1.2", "1.2.0")).toBe(0);
    expect(compareVersions("garbage", "0.0.0")).toBe(0);
    expect(compareVersions("1.0.0", "garbage")).toBeGreaterThan(0);
  });

  it("sorts a list ascending", () => {
    expect(["1.10.0", "1.2.0", "1.9.1"].sort(compareVersions)).toEqual(["1.2.0", "1.9.1", "1.10.0"]);
  });
});
