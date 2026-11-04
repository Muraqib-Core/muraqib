// Fails when a commit range carries AI attribution: a Claude/anthropic.com
// author or committer, or a Claude attribution trailer in the message.
// Usage: node scripts/check-commit-identity.mjs <base> <head>
//        (or BASE_SHA / HEAD_SHA environment variables)
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import process from "node:process";

const FIELD = "\x1f";
const RECORD = "\x1e";
const IDENTITY_PATTERN = /claude|anthropic\.com/i;
const MESSAGE_RULES = [
  { label: "Co-Authored-By: Claude", pattern: /co-authored-by:\s*claude/i },
  { label: "Claude-Session:", pattern: /claude-session:/i },
  { label: "Generated with Claude Code", pattern: /generated with \[?claude code/i },
];

/**
 * Parses `git log --format=%H<US>%an<US>%ae<US>%cn<US>%ce<US>%B<RS>` output.
 * @param {string} raw
 * @returns {{sha: string, authorName: string, authorEmail: string, committerName: string, committerEmail: string, message: string}[]}
 */
export function parseLog(raw) {
  return raw
    .split(RECORD)
    .map((record) => record.replace(/^\n+/, ""))
    .filter((record) => record.trim() !== "")
    .map((record) => {
      const [sha = "", authorName = "", authorEmail = "", committerName = "", committerEmail = "", ...rest] =
        record.split(FIELD);
      return { sha, authorName, authorEmail, committerName, committerEmail, message: rest.join(FIELD) };
    });
}

/**
 * Returns one human-readable violation per offending field.
 * @param {ReturnType<typeof parseLog>} commits
 * @returns {string[]}
 */
export function findViolations(commits) {
  const violations = [];
  for (const commit of commits) {
    const short = commit.sha.slice(0, 12);
    const identities = [
      ["author name", commit.authorName],
      ["author email", commit.authorEmail],
      ["committer name", commit.committerName],
      ["committer email", commit.committerEmail],
    ];
    for (const [field, value] of identities) {
      if (IDENTITY_PATTERN.test(value ?? "")) violations.push(`${short}: ${field} "${value}" is not allowed`);
    }
    for (const rule of MESSAGE_RULES) {
      if (rule.pattern.test(commit.message)) violations.push(`${short}: message contains "${rule.label}"`);
    }
  }
  return violations;
}

/**
 * @param {string} base
 * @param {string} head
 * @param {string} [cwd] repository directory (defaults to the current one)
 * @returns {string[]}
 */
export function checkRange(base, head, cwd = process.cwd()) {
  const format = ["%H", "%an", "%ae", "%cn", "%ce", "%B"].join(FIELD) + RECORD;
  const raw = execFileSync("git", ["log", `--format=${format}`, `${base}..${head}`], {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return findViolations(parseLog(raw));
}

function main() {
  const base = process.argv[2] ?? process.env.BASE_SHA;
  const head = process.argv[3] ?? process.env.HEAD_SHA ?? "HEAD";
  if (!base) {
    process.stderr.write("Usage: check-commit-identity.mjs <base> [head]\n");
    return 2;
  }
  const violations = checkRange(base, head);
  if (violations.length > 0) {
    process.stderr.write(`Commit identity check failed:\n${violations.map((v) => `  - ${v}`).join("\n")}\n`);
    return 1;
  }
  process.stdout.write(`Commit identity OK for ${base}..${head}\n`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = main();
