/**
 * Reads what is staged for the next commit, without touching the working tree.
 *
 * Uses a single `git diff --cached -U0` so only the lines being added are returned (with their
 * line numbers in the staged version); an unrelated old secret in a file you touch never matches.
 */
import { runGit } from "../core/helpers/git-protection.js";
import type { SecretScanTarget } from "../core/secret-guard.js";

/** Decodes a git-quoted path (`"a\tb"`, octal escapes) into the real path. */
export function unquoteGitPath(raw: string): string {
  if (!(raw.startsWith('"') && raw.endsWith('"'))) return raw;
  const bytes: number[] = [];
  const chars = Array.from(raw.slice(1, -1));
  const escapes: Record<string, number> = { n: 10, t: 9, r: 13, '"': 34, "\\": 92 };
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i] ?? "";
    const octal = /^[0-7]{3}$/.exec(chars.slice(i + 1, i + 4).join(""))?.[0];
    if (ch !== "\\") bytes.push(...Buffer.from(ch));
    else if (octal !== undefined) {
      bytes.push(Number.parseInt(octal, 8));
      i += 3;
    } else {
      const escaped = escapes[chars[i + 1] ?? ""];
      bytes.push(escaped ?? 92);
      if (escaped !== undefined) i += 1;
    }
  }
  return Buffer.from(bytes).toString("utf8");
}

/** The new path from a `+++ b/<path>` header, or undefined for `/dev/null` and malformed headers. */
function destinationPath(header: string): string | undefined {
  const raw = header.slice(4).replace(/\t.*$/, "");
  if (raw === "/dev/null") return undefined;
  const unquoted = unquoteGitPath(raw);
  return unquoted.startsWith("b/") ? unquoted.slice(2) : undefined;
}

/**
 * Parses a zero-context unified diff into the lines it adds, per file.
 *
 * @param patch - Output of `git diff -U0`
 * @returns One target per file that has added lines, in diff order
 */
export function parseAddedLines(patch: string): SecretScanTarget[] {
  const targets: SecretScanTarget[] = [];
  let current: { file: string; lines: { line: number; text: string }[] } | undefined;
  let nextLine = 0;
  let inHunk = false;
  for (const row of patch.split("\n")) {
    if (row.startsWith("diff --git ")) {
      current = undefined;
      inHunk = false;
    } else if (!inHunk && row.startsWith("+++ ")) {
      const file = destinationPath(row);
      current = file === undefined ? undefined : { file, lines: [] };
      if (current) targets.push(current);
    } else if (row.startsWith("@@")) {
      inHunk = true;
      nextLine = Number.parseInt(/\+(\d+)/.exec(row)?.[1] ?? "0", 10);
    } else if (current && row.startsWith("+")) {
      current.lines.push({ line: nextLine, text: row.slice(1).replace(/\r$/, "") });
      nextLine += 1;
    }
  }
  return targets.filter((target) => target.lines.length > 0);
}

/**
 * Reads the lines added by the staged changes (added, copied, modified and renamed files).
 *
 * @param gitRoot - Repository root
 * @returns Added lines per file
 * @throws When git cannot produce the diff
 */
export function readStagedAdditions(gitRoot: string): SecretScanTarget[] {
  const { status, stdout } = runGit(
    ["-c", "core.quotepath=off", "diff", "--cached", "-U0", "--no-color", "--no-ext-diff", "--diff-filter=ACMR", "--src-prefix=a/", "--dst-prefix=b/"],
    gitRoot
  );
  if (status !== 0) throw new Error("git diff --cached failed");
  return parseAddedLines(stdout);
}
