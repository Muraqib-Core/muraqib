import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { z } from "zod";
import { createEnvWithPresets } from "../../../src/env/presets.js";

describe("createEnvWithPresets", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("validates against the user schema alone", () => {
    const env = createEnvWithPresets({ A: z.string() }, { runtimeEnv: { A: "a" }, silent: true });
    expect(env).toEqual({ A: "a" });
  });

  test("injects a known preset and announces it", () => {
    const env = createEnvWithPresets(
      { A: z.string() },
      { runtimeEnv: { A: "a", VERCEL: "1" }, presets: ["vercel"] }
    );
    expect(env).toMatchObject({ A: "a", VERCEL: "1" });
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("[vercel]"));
  });

  test("applies preset validation rules", () => {
    expect(() =>
      createEnvWithPresets({}, { runtimeEnv: {}, presets: ["neonVercel"], silent: true })
    ).toThrow();
  });

  test("warns about unknown presets unless silent", () => {
    createEnvWithPresets({}, { runtimeEnv: {}, presets: ["nope" as never] });
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("Unknown preset [nope]"));
    vi.mocked(console.warn).mockClear();
    createEnvWithPresets({}, { runtimeEnv: {}, presets: ["nope" as never], silent: true });
    expect(console.warn).not.toHaveBeenCalled();
  });

  test("forwards optional flags to createEnv", () => {
    const env = createEnvWithPresets(
      { A: z.string() },
      {
        runtimeEnv: { A: "" },
        emptyStringAsUndefined: false,
        isServer: true,
        skipValidation: false,
        silent: true,
        formatError: () => "custom",
        preserveProcessEnv: true,
      }
    );
    expect(env).toEqual({ A: "" });
    expect(() =>
      createEnvWithPresets(
        { A: z.string() },
        { runtimeEnv: {}, silent: true, formatError: () => "custom message" }
      )
    ).toThrow("custom message");
  });

  test("skips validation when asked", () => {
    expect(
      createEnvWithPresets({ A: z.string() }, { runtimeEnv: {}, skipValidation: true, silent: true })
    ).toBe(process.env);
  });

  test("returns null outside the schedule window", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-07T12:00:00Z"));
    expect(
      createEnvWithPresets({}, { runtimeEnv: {}, schedule: "on weekends", silent: true })
    ).toBeNull();
    vi.useRealTimers();
  });
});
