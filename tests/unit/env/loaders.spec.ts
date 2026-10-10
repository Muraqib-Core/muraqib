import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { loadEnv } from "../../../src/env/loaders.js";

const TOUCHED = [
  "NODE_ENV",
  "PORT",
  "STATIC_ASSETS_CACHE_MAX_AGE",
  "ENABLE_SERVER_COMPRESSION",
  "LD_A",
  "LD_B",
  "LD_C",
  "LD_Q",
  "LD_MULTI",
  "LD_EXP",
  "LD_SECRET_TOKEN",
  "LD_REF",
  "LD_DEF",
  "LD_LOCAL",
  "LD_EXPORTED",
  "LD_COMMENT",
  "LD_HASH",
];

describe("loadEnv", () => {
  let dir = "";
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "muraqib-loaders-"));
    for (const key of TOUCHED) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of TOUCHED) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    fs.rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  const write = (name: string, content: string): void =>
    fs.writeFileSync(path.join(dir, name), content);

  test("loads .env and exports values to process.env", () => {
    write(".env", "LD_A=1\nLD_B=two\n");
    const loaded = loadEnv({ cwd: dir });
    expect(loaded).toMatchObject({ LD_A: "1", LD_B: "two" });
    expect(process.env.LD_A).toBe("1");
  });

  test("does not touch process.env when preserveProcessEnv is set", () => {
    write(".env", "LD_A=1\n");
    loadEnv({ cwd: dir, preserveProcessEnv: true });
    expect(process.env.LD_A).toBeUndefined();
  });

  test("ignores blank lines, comments and lines without '='", () => {
    write(".env", "# comment\n\nnot-a-pair\nLD_A=1\n");
    expect(loadEnv({ cwd: dir, preserveProcessEnv: true })).toEqual({ LD_A: "1" });
  });

  test("strips inline comments but keeps '#' inside quotes", () => {
    write(".env", `LD_COMMENT=value # trailing\nLD_HASH="a#b"\n`);
    const loaded = loadEnv({ cwd: dir, preserveProcessEnv: true });
    expect(loaded.LD_COMMENT).toBe("value");
    expect(loaded.LD_HASH).toBe("a#b");
  });

  test("unwraps quoted values and supports the export prefix", () => {
    write(".env", `LD_Q='quoted value'\nexport LD_EXPORTED="yes"\n`);
    const loaded = loadEnv({ cwd: dir, preserveProcessEnv: true });
    expect(loaded.LD_Q).toBe("quoted value");
    expect(loaded.LD_EXPORTED).toBe("yes");
  });

  test("joins continuation lines that end with a backslash", () => {
    write(".env", "LD_MULTI=first \\\nsecond \\\nthird\nLD_A=1\n");
    const loaded = loadEnv({ cwd: dir, preserveProcessEnv: true });
    expect(loaded.LD_MULTI).toContain("first");
    expect(loaded.LD_MULTI).toContain("third");
    expect(loaded.LD_A).toBe("1");
  });

  test("keeps a pending continuation value at end of file", () => {
    write(".env", "LD_MULTI=start \\");
    const loaded = loadEnv({ cwd: dir, preserveProcessEnv: true });
    expect(loaded.LD_MULTI).toBe("start \\");
  });

  test("expands ${VAR} references and defaults", () => {
    write(".env", "LD_A=base\nLD_REF=${LD_A}/x\nLD_DEF=${LD_MISSING:-fallback}\n");
    const loaded = loadEnv({ cwd: dir, preserveProcessEnv: true });
    expect(loaded.LD_REF).toBe("base/x");
    expect(loaded.LD_DEF).toBe("fallback");
  });

  test("warns when a sensitive variable is expanded", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    write(".env", "LD_SECRET_TOKEN=abc\nLD_EXP=$LD_SECRET_TOKEN\n");
    loadEnv({ cwd: dir, preserveProcessEnv: true });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("LD_SECRET_TOKEN"));
  });

  test("later files override earlier ones and NODE_ENV selects a file", () => {
    process.env.NODE_ENV = "staging";
    write(".env", "LD_A=base\n");
    write(".env.staging", "LD_A=staging\n");
    write(".env.local", "LD_LOCAL=yes\n");
    const loaded = loadEnv({ cwd: dir, preserveProcessEnv: true });
    expect(loaded.LD_A).toBe("staging");
    expect(loaded.LD_LOCAL).toBe("yes");
  });

  test("honours an explicit file list and skips missing files", () => {
    write("custom.env", "LD_C=3\n");
    const loaded = loadEnv({
      cwd: dir,
      files: ["missing.env", "custom.env"],
      preserveProcessEnv: true,
    });
    expect(loaded).toEqual({ LD_C: "3" });
  });

  test("logs each loaded key in verbose mode", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    write(".env", "LD_A=1\n");
    loadEnv({ cwd: dir, verbose: true, preserveProcessEnv: true });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("LD_A"));
  });

  test("warns and continues when a file cannot be read", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    fs.mkdirSync(path.join(dir, ".env")); // a directory: existsSync true, read fails
    expect(loadEnv({ cwd: dir, preserveProcessEnv: true })).toEqual({});
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Failed to load"));
  });

  test("sets defaults for PORT, cache max age and compression", () => {
    loadEnv({ cwd: dir, preserveProcessEnv: true });
    expect(process.env.PORT).toBe("3000");
    expect(process.env.STATIC_ASSETS_CACHE_MAX_AGE).toBe("86400");
    expect(process.env.ENABLE_SERVER_COMPRESSION).toBe("true");
  });

  test("does not override an existing PORT", () => {
    process.env.PORT = "8080";
    loadEnv({ cwd: dir, preserveProcessEnv: true });
    expect(process.env.PORT).toBe("8080");
  });
});
