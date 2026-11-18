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
  "LD_PASS",
  "LD_PEM",
  "LD_ESC",
  "LD_LIT",
  "LD_SYS",
  "LD_SELF",
  "LD_EMPTY",
  "LD_CHAIN",
  "LD_BOM",
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

  describe("dotenv syntax", () => {
    const load = (content: string): Record<string, string> => {
      write(".env", content);
      return loadEnv({ cwd: dir, preserveProcessEnv: true });
    };

    test("reads multi-line double-quoted values (PEM style)", () => {
      const loaded = load('LD_PEM="-----BEGIN-----\nabc\n-----END-----"\nLD_A=1\n');
      expect(loaded.LD_PEM).toBe("-----BEGIN-----\nabc\n-----END-----");
      expect(loaded.LD_A).toBe("1");
    });

    test("decodes escapes only inside double quotes", () => {
      const loaded = load('LD_ESC="a\\nb\\"c"\nLD_LIT=\'a\\nb\'\n');
      expect(loaded.LD_ESC).toBe('a\nb"c');
      expect(loaded.LD_LIT).toBe("a\\nb");
    });

    test("does not expand single-quoted or backtick values", () => {
      const loaded = load("LD_A=base\nLD_LIT='$LD_A and ${LD_A}'\nLD_B=`$LD_A`\n");
      expect(loaded.LD_LIT).toBe("$LD_A and ${LD_A}");
      expect(loaded.LD_B).toBe("$LD_A");
    });

    test("keeps a literal dollar written as \\$", () => {
      expect(load("LD_PASS=pa\\$word\n").LD_PASS).toBe("pa$word");
    });

    test("starts a comment only after whitespace, so '#' inside a value survives", () => {
      const loaded = load("LD_PASS=pa#ss\nLD_COMMENT=x #c\nLD_HASH=#whole\n");
      expect(loaded.LD_PASS).toBe("pa#ss");
      expect(loaded.LD_COMMENT).toBe("x");
      expect(loaded.LD_HASH).toBe("");
    });

    test("treats an unterminated quote as a plain value without swallowing the file", () => {
      const loaded = load('LD_A="oops\nLD_B=2\n');
      expect(loaded.LD_A).toBe('"oops');
      expect(loaded.LD_B).toBe("2");
    });

    test("strips a BOM and ignores invalid keys", () => {
      const loaded = load("\uFEFFLD_BOM=1\n=x\n1BAD=y\nbad key=z\n");
      expect(loaded).toEqual({ LD_BOM: "1" });
    });

    test("${VAR:-d} falls back for empty values, ${VAR-d} only for unset ones", () => {
      const loaded = load("LD_EMPTY=\nLD_A=${LD_EMPTY:-colon}\nLD_B=${LD_EMPTY-dash}\nLD_C=${LD_NOPE-dash}\n");
      expect(loaded.LD_A).toBe("colon");
      expect(loaded.LD_B).toBe("");
      expect(loaded.LD_C).toBe("dash");
    });

    test("resolves references to later keys and chains", () => {
      const loaded = load("LD_CHAIN=$LD_B/c\nLD_B=$LD_A/b\nLD_A=a\n");
      expect(loaded.LD_CHAIN).toBe("a/b/c");
    });

    test("does not treat unbalanced braces as a reference", () => {
      expect(load("LD_A=x\nLD_B=${LD_A\n").LD_B).toBe("${LD_A");
    });

    test("warns about undefined references in verbose mode only", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      write(".env", "LD_A=pa$word\n");
      loadEnv({ cwd: dir, preserveProcessEnv: true });
      expect(warn).not.toHaveBeenCalled();
      loadEnv({ cwd: dir, preserveProcessEnv: true, verbose: true });
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('"word"'));
    });
  });

  describe("precedence", () => {
    test("variables already in process.env win by default", () => {
      process.env.LD_SYS = "system";
      write(".env", "LD_SYS=file\nLD_REF=${LD_SYS}!\n");
      const loaded = loadEnv({ cwd: dir });
      expect(loaded.LD_SYS).toBe("system");
      expect(loaded.LD_REF).toBe("system!");
      expect(process.env.LD_SYS).toBe("system");
    });

    test("override lets the file replace process.env", () => {
      process.env.LD_SYS = "system";
      write(".env", "LD_SYS=file\nLD_REF=${LD_SYS}!\n");
      const loaded = loadEnv({ cwd: dir, override: true });
      expect(loaded.LD_SYS).toBe("file");
      expect(loaded.LD_REF).toBe("file!");
      expect(process.env.LD_SYS).toBe("file");
    });

    test("an empty system value still counts as set", () => {
      process.env.LD_SYS = "";
      write(".env", "LD_SYS=file\n");
      expect(loadEnv({ cwd: dir }).LD_SYS).toBe("");
    });

    test("a self-reference appends to the real value instead of looping", () => {
      process.env.LD_SELF = "base";
      write(".env", "LD_SELF=$LD_SELF:/x\n");
      expect(loadEnv({ cwd: dir, override: true }).LD_SELF).toBe("base:/x");
    });
  });
});
