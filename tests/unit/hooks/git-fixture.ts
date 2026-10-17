import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Runs git in `cwd`, throwing with git's own message on failure. */
export function git(cwd: string, ...args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout;
}

/** A fresh repository with an identity, in a unique temp directory (realpath'd, as git reports it). */
export function initRepo(): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "muraqib-hooks-")));
  git(dir, "init", "-q");
  git(dir, "config", "user.email", "test@example.com");
  git(dir, "config", "user.name", "Test");
  git(dir, "config", "commit.gpgsign", "false");
  return dir;
}

/** Writes a file (creating parent directories) relative to `root`. */
export function write(root: string, file: string, content: string | Buffer): void {
  const full = path.join(root, file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

/** Keeps the machine's global/system git config (hooksPath, diff settings, ...) out of a test. */
export function isolateGit(): () => void {
  const saved = { global: process.env["GIT_CONFIG_GLOBAL"], nosystem: process.env["GIT_CONFIG_NOSYSTEM"] };
  process.env["GIT_CONFIG_GLOBAL"] = os.devNull;
  process.env["GIT_CONFIG_NOSYSTEM"] = "1";
  return () => {
    for (const [key, value] of [["GIT_CONFIG_GLOBAL", saved.global], ["GIT_CONFIG_NOSYSTEM", saved.nosystem]] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}
