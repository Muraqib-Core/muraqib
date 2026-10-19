import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  runGit,
  globToRegExp,
  isIgnoredByGitignoreFile,
  isGitIgnored,
  trackedEnvFiles,
} from "../../../../src/core/helpers/git-protection.js";

const ENV_FILE = /^\.env(?:\..+)?$/;
const ENV_TEMPLATE = /\.(?:example|sample|template|dist)$/i;

describe("git-protection", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "muraqib-gitprot-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function initRepo(): void {
    expect(runGit(["init", "-q"], dir).status).toBe(0);
  }

  describe("runGit", () => {
    it("returns the exit status and stdout", () => {
      initRepo();
      const result = runGit(["rev-parse", "--is-inside-work-tree"], dir);
      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toBe("true");
    });

    it("returns a null status when git cannot run (missing cwd)", () => {
      expect(runGit(["status"], join(dir, "does-not-exist")).status).toBeNull();
    });
  });

  describe("globToRegExp", () => {
    it.each([
      ["*.log", "a.log", true],
      ["*.log", "dir/a.log", false],
      ["**/cache", "a/b/cache", true],
      ["**/cache", "cache", true],
      ["logs/**", "logs/x/y", true],
      ["file?.txt", "file1.txt", true],
      ["file?.txt", "file12.txt", false],
      ["a.b+c", "a.b+c", true],
      ["a.b+c", "aXb+c", false],
    ])("%s vs %s -> %s", (glob, subject, expected) => {
      expect(globToRegExp(glob).test(subject)).toBe(expected);
    });
  });

  describe("isIgnoredByGitignoreFile", () => {
    it("returns false when the file is unreadable", () => {
      expect(isIgnoredByGitignoreFile(dir, ".env", join(dir, ".gitignore"))).toBe(false);
    });

    it("applies patterns, comments, anchoring, directories and negation in order", () => {
      writeFileSync(
        join(dir, ".gitignore"),
        ["# comment", "", ".env", ".env.*", "!.env.example", "/secrets/key.pem", "/", "build/"].join("\r\n")
      );
      const gi = join(dir, ".gitignore");
      expect(isIgnoredByGitignoreFile(dir, ".env", gi)).toBe(true);
      expect(isIgnoredByGitignoreFile(dir, "apps/web/.env.local", gi)).toBe(true);
      expect(isIgnoredByGitignoreFile(dir, ".env.example", gi)).toBe(false);
      expect(isIgnoredByGitignoreFile(dir, "secrets/key.pem", gi)).toBe(true);
      expect(isIgnoredByGitignoreFile(dir, "other/key.pem", gi)).toBe(false);
      expect(isIgnoredByGitignoreFile(dir, "readme.md", gi)).toBe(false);
    });
  });

  describe("isGitIgnored", () => {
    it("uses git check-ignore inside a repository", () => {
      initRepo();
      writeFileSync(join(dir, ".gitignore"), ".env\n");
      expect(isGitIgnored(dir, ".env")).toBe(true);
      expect(isGitIgnored(dir, ".env.local")).toBe(false);
    });

    it("falls back to parsing .gitignore outside a repository", () => {
      writeFileSync(join(dir, ".gitignore"), ".env\n");
      expect(isGitIgnored(dir, ".env")).toBe(true);
      expect(isGitIgnored(dir, "app.ts")).toBe(false);
    });
  });

  describe("trackedEnvFiles", () => {
    it("lists tracked env files and skips templates and other files", () => {
      initRepo();
      mkdirSync(join(dir, "apps"));
      for (const file of [".env", ".env.example", ".env.production", "apps/.env.local", "app.ts"]) {
        writeFileSync(join(dir, file), "A=1\n");
      }
      expect(runGit(["add", "-A"], dir).status).toBe(0);
      expect(trackedEnvFiles(dir, ENV_FILE, ENV_TEMPLATE).sort()).toEqual([
        ".env",
        ".env.production",
        "apps/.env.local",
      ]);
    });

    it("returns nothing outside a repository", () => {
      writeFileSync(join(dir, ".env"), "A=1\n");
      expect(trackedEnvFiles(dir, ENV_FILE, ENV_TEMPLATE)).toEqual([]);
    });
  });
});
