import { describe, expect, it } from "vitest";
import { firstNonEmpty, nonEmpty } from "../../../src/utils/defaults.js";

describe("default helpers", () => {
  it("firstNonEmpty skips undefined, null and empty strings", () => {
    expect(firstNonEmpty(undefined, null, "", "a", "b")).toBe("a");
    expect(firstNonEmpty("", undefined)).toBeUndefined();
    expect(firstNonEmpty()).toBeUndefined();
  });

  it("nonEmpty falls back for empty strings (unlike ??)", () => {
    expect(nonEmpty("", "x")).toBe("x");
    expect(nonEmpty(undefined, "x")).toBe("x");
    expect(nonEmpty(null, "x")).toBe("x");
    expect(nonEmpty("v", "x")).toBe("v");
  });
});
