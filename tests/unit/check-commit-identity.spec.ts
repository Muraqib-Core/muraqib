import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

interface Commit {
  sha: string;
  authorName: string;
  authorEmail: string;
  committerName: string;
  committerEmail: string;
  message: string;
}
interface CheckModule {
  parseLog(raw: string): Commit[];
  findViolations(commits: Commit[]): string[];
  checkRange(base: string, head: string, cwd?: string): string[];
}

const scriptPath = resolve(__dirname, "../../scripts/check-commit-identity.mjs");
const mod = (await import(/* @vite-ignore */ pathToFileURL(scriptPath).href)) as CheckModule;

const clean: Commit = {
  sha: "a".repeat(40),
  authorName: "Aya almadhon",
  authorEmail: "aya@example.com",
  committerName: "Aya almadhon",
  committerEmail: "aya@example.com",
  message: "fix: resolve npm ci failure\n",
};

describe("findViolations", () => {
  it("accepts a clean commit", () => {
    expect(mod.findViolations([clean])).toEqual([]);
  });

  it("flags Claude / anthropic.com in author and committer identity", () => {
    const out = mod.findViolations([
      { ...clean, authorName: "Claude" },
      { ...clean, authorEmail: "noreply@anthropic.com" },
      { ...clean, committerName: "claude bot" },
      { ...clean, committerEmail: "x@ANTHROPIC.COM" },
    ]);
    expect(out).toHaveLength(4);
    expect(out[0]).toContain("author name");
    expect(out[1]).toContain("author email");
    expect(out[2]).toContain("committer name");
    expect(out[3]).toContain("committer email");
  });

  it("flags attribution trailers in the message", () => {
    const out = mod.findViolations([
      { ...clean, message: "feat: x\n\nCo-Authored-By: Claude Sonnet <noreply@example.com>\n" },
      { ...clean, message: "feat: x\n\nClaude-Session: https://claude.ai/code/session_1\n" },
      { ...clean, message: "feat: x\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)\n" },
      { ...clean, message: "feat: x\n\nGenerated with Claude Code\n" },
    ]);
    expect(out).toHaveLength(4);
  });

  it("does not flag a human co-author", () => {
    expect(mod.findViolations([{ ...clean, message: "feat: x\n\nCo-Authored-By: Sam <sam@example.com>\n" }])).toEqual([]);
  });
});

describe("parseLog", () => {
  it("parses records and keeps multi-line messages", () => {
    const rec = (sha: string, msg: string): string =>
      ["" + sha, "A", "a@x.io", "C", "c@x.io", msg].join("\x1f") + "\x1e\n";
    const out = mod.parseLog(rec("1", "subject\n\nbody\n") + rec("2", "other\n"));
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ sha: "1", authorName: "A", committerEmail: "c@x.io" });
    expect(out[0]?.message).toContain("body");
    expect(out[1]?.sha).toBe("2");
  });

  it("returns an empty list for empty output", () => {
    expect(mod.parseLog("")).toEqual([]);
  });
});

describe("checkRange (real git repository)", () => {
  it("detects offending commits in the range only", () => {
    const dir = mkdtempSync(join(tmpdir(), "muraqib-ident-"));
    const git = (args: string[], env: Record<string, string> = {}): string =>
      execFileSync("git", args, { cwd: dir, encoding: "utf8", env: { ...process.env, ...env } }).trim();
    try {
      git(["init", "-q"]);
      const human = {
        GIT_AUTHOR_NAME: "Aya", GIT_AUTHOR_EMAIL: "aya@example.com",
        GIT_COMMITTER_NAME: "Aya", GIT_COMMITTER_EMAIL: "aya@example.com",
      };
      const commit = (msg: string, env: Record<string, string>): void => {
        writeFileSync(join(dir, "f.txt"), msg);
        git(["add", "."]);
        git(["-c", "commit.gpgsign=false", "commit", "-q", "-m", msg], env);
      };
      commit("base", { ...human, GIT_AUTHOR_NAME: "Claude" });
      const base = git(["rev-parse", "HEAD"]);
      commit("ok", human);
      expect(mod.checkRange(base, "HEAD", dir)).toEqual([]);
      commit("bad\n\nClaude-Session: s", human);
      commit("bot", { ...human, GIT_COMMITTER_EMAIL: "noreply@anthropic.com" });
      expect(mod.checkRange(base, "HEAD", dir)).toHaveLength(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
