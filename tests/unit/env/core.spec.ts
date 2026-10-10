import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { z } from "zod";
import { createEnv, safeCreateEnv } from "../../../src/env/core.js";

// The option generics reject loosely-typed schemas, so tests go through a loose signature.
const make = createEnv as unknown as (opts: Record<string, unknown>) => Record<string, unknown> | null;
const makeSafe = safeCreateEnv as unknown as (opts: Record<string, unknown>) => {
  success: boolean;
  data?: Record<string, unknown>;
  error?: Array<{ path: string; message: string }>;
};

describe("env createEnv", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  test("returns validated, coerced data", () => {
    const env = make({
      server: { PORT: z.coerce.number() },
      runtimeEnv: { PORT: "8080" },
      silent: true,
    });
    expect(env).toEqual({ PORT: 8080 });
  });

  test("merges server and client schemas", () => {
    const env = make({
      server: { SECRET: z.string() },
      client: { PUBLIC_URL: z.string() },
      clientPrefix: "PUBLIC_",
      runtimeEnv: { SECRET: "s", PUBLIC_URL: "u" },
      silent: true,
    });
    expect(env).toEqual({ SECRET: "s", PUBLIC_URL: "u" });
  });

  test("prefers runtimeEnvStrict over runtimeEnv", () => {
    const env = make({
      server: { A: z.string() },
      runtimeEnvStrict: { A: "strict" },
      runtimeEnv: { A: "loose" },
      silent: true,
    });
    expect(env).toEqual({ A: "strict" });
  });

  test("falls back to process.env when no runtime env is given", () => {
    vi.stubEnv("MURAQIB_TEST_VAR", "from-process");
    const env = make({ server: { MURAQIB_TEST_VAR: z.string() }, silent: true });
    vi.unstubAllEnvs();
    expect(env).toEqual({ MURAQIB_TEST_VAR: "from-process" });
  });

  test("merges extended objects and ignores non-objects", () => {
    const env = make({
      server: { A: z.string(), B: z.string() },
      runtimeEnv: { A: "a" },
      extends: [{ B: "b" }, null, "nope"],
      silent: true,
    });
    expect(env).toEqual({ A: "a", B: "b" });
  });

  test("treats empty strings as undefined by default", () => {
    const env = make({
      server: { A: z.string().default("fallback") },
      runtimeEnv: { A: "" },
      silent: true,
    });
    expect(env).toEqual({ A: "fallback" });
  });

  test("keeps empty strings when emptyStringAsUndefined is false", () => {
    const env = make({
      server: { A: z.string() },
      runtimeEnv: { A: "" },
      emptyStringAsUndefined: false,
      silent: true,
    });
    expect(env).toEqual({ A: "" });
  });

  test("logs progress unless silent", () => {
    make({ server: { A: z.string() }, runtimeEnv: { A: "a" } });
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("Building and executing"));
  });

  test("throws a tagged error listing the violations", () => {
    try {
      make({ server: { A: z.string(), B: z.string() }, runtimeEnv: {}, silent: true });
      expect.unreachable("should have thrown");
    } catch (err) {
      const e = err as Error & { isMuraqibCustom: boolean; errors: Array<{ path: string }> };
      expect(e.isMuraqibCustom).toBe(true);
      expect(e.errors.map((x) => x.path)).toEqual(["A", "B"]);
      expect(e.message).toContain("2 violation(s)");
    }
  });

  test("prints the error unless silent and supports a custom formatter", () => {
    expect(() => make({ server: { A: z.string() }, runtimeEnv: {} })).toThrow();
    expect(console.error).toHaveBeenCalled();
    expect(() =>
      make({
        server: { A: z.string() },
        runtimeEnv: {},
        silent: true,
        formatError: (issues: Array<{ path: string }>) => `custom:${issues[0]?.path}`,
      })
    ).toThrow("custom:A");
  });

  test("skips validation and returns process.env when requested", () => {
    const env = make({ server: { NOPE: z.string() }, skipValidation: true });
    expect(env).toBe(process.env);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("Validation skipped"));
    expect(make({ server: { NOPE: z.string() }, skipValidation: true, silent: true })).toBe(process.env);
  });

  test("returns null outside the schedule window", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-07T12:00:00Z")); // a Wednesday
    const result = make({ server: {}, runtimeEnv: {}, schedule: "on weekends" });
    expect(result).toBeNull();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("outside allowed cron window"));
    expect(make({ server: {}, runtimeEnv: {}, schedule: "on weekends", silent: true })).toBeNull();
  });

  test("runs inside the schedule window", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-10T12:00:00Z")); // a Saturday
    expect(make({ server: {}, runtimeEnv: {}, schedule: "on weekends", silent: true })).toEqual({});
  });

  test("loads env files given by envFilePath", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "muraqib-envcore-"));
    const file = path.join(dir, "x.env");
    fs.writeFileSync(file, "MURAQIB_FROM_FILE=yes\n");
    const cwd = process.cwd();
    process.chdir(dir);
    try {
      const env = make({
        server: { MURAQIB_FROM_FILE: z.string() },
        envFilePath: ["x.env"],
        preserveProcessEnv: false,
        silent: true,
      });
      expect(env).toEqual({ MURAQIB_FROM_FILE: "yes" });
      make({ server: {}, envFilePath: "x.env", runtimeEnv: {}, silent: true });
    } finally {
      process.chdir(cwd);
      delete process.env.MURAQIB_FROM_FILE;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("env safeCreateEnv", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  test("returns success with data", () => {
    const result = makeSafe({ server: { A: z.string() }, runtimeEnv: { A: "a" }, silent: true });
    expect(result).toEqual({ success: true, data: { A: "a" } });
  });

  test("returns the validation errors on failure", () => {
    const result = makeSafe({ server: { A: z.string() }, runtimeEnv: {}, silent: true });
    expect(result.success).toBe(false);
    expect(result.error?.[0]?.path).toBe("A");
  });

  test("reports a schedule miss", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-07T12:00:00Z"));
    const result = makeSafe({ server: {}, runtimeEnv: {}, schedule: "on weekends", silent: true });
    expect(result.error?.[0]?.path).toBe("schedule");
  });

  test("wraps unexpected errors", () => {
    const result = makeSafe({
      server: { A: z.string() },
      get runtimeEnv(): never {
        throw new Error("exploded");
      },
      silent: true,
    });
    expect(result).toEqual({ success: false, error: [{ path: "unknown", message: "exploded" }] });
    const nonError = makeSafe({
      server: {},
      get runtimeEnv(): never {
        throw "string";
      },
      silent: true,
    });
    expect(nonError.error?.[0]?.message).toBe("Unknown error");
  });
});
