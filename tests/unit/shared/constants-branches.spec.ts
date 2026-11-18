import { afterEach, describe, expect, it, vi } from "vitest";

describe("COLORS NO_COLOR handling", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("returns ANSI codes when NO_COLOR is unset or empty", async () => {
    vi.stubEnv("NO_COLOR", "");
    vi.resetModules();
    const { COLORS } = await import("../../../src/shared/constants.js");
    expect(COLORS.RED).toBe("\x1b[31m");
    expect(COLORS.RESET).toBe("\x1b[0m");
  });

  it("returns empty strings when NO_COLOR is non-empty", async () => {
    vi.stubEnv("NO_COLOR", "1");
    vi.resetModules();
    const { COLORS } = await import("../../../src/shared/constants.js");
    expect(Object.values(COLORS).every((v) => v === "")).toBe(true);
  });
});
