import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { containsSecret, redactText } from "../explain/redact.js";
import { makePatch } from "./patch.js";
import { applyEdits, readIfExists } from "./project-copy.js";
import type { ProposedFix } from "./types.js";

/** Maximum diff lines printed per file; the rest is summarised as `... N more line(s)`. */
const MAX_LINES_PER_FILE = 40;
const REMOVED_SECRET_LINE = "-   (line removed; content hidden because it contains a secret)";
const HIDDEN_LINE = "(line hidden: looks like a secret)";
const UNAVAILABLE = "(preview unavailable)";

interface FileDiff {
  isNew: boolean;
  /** Hunk headers and `+`/`-`/space lines, without trailing CR. */
  lines: string[];
}

/** Splits a multi-file `git diff` into one block per file, keyed by project-relative path. */
function splitDiff(patch: string): Map<string, FileDiff> {
  const blocks = new Map<string, FileDiff>();
  let current: FileDiff | undefined;
  let inHunk = false;
  for (const raw of patch.split("\n")) {
    // Content lines always start with a space, `+` or `-`, so this can only be a file header.
    // Matches "diff --git a/src/x.ts b/src/x.ts" (a new file is "diff --git b/src/x.ts b/src/x.ts").
    const header = /^diff --git [ab]\/(.+) [ab]\/(.+)$/.exec(raw);
    if (header?.[2] !== undefined) {
      current = { isNew: false, lines: [] };
      blocks.set(header[2], current);
      inHunk = false;
    } else if (current !== undefined) {
      if (!inHunk && raw.startsWith("new file mode")) current.isNew = true;
      if (raw.startsWith("@@")) inHunk = true;
      if (inHunk && raw !== "") current.lines.push(raw.replace(/\r$/, ""));
    }
  }
  return blocks;
}

/** Hunk header without the function name git may append (that text comes from the file and could hold a secret). */
function cleanHunkHeader(line: string): string {
  const end = line.indexOf("@@", 2);
  return end === -1 ? "@@" : line.slice(0, end + 2);
}

/**
 * `redactText` treats `key = process.env.NAME` as an assignment of a secret value and would blank
 * the very line the preview must show. Environment references cannot hold a value, so they are
 * swapped for short markers (too short to look like a value) while redacting, then restored.
 */
function redactKeepingEnvRefs(text: string): { text: string; secret: boolean } {
  // Matches "process.env.STRIPE_KEY"; rejects "process.environment" and "process.env[x]".
  const envRef = /process\.env\.[A-Za-z_][A-Za-z0-9_]*/g;
  const refs = text.match(envRef) ?? [];
  const masked = refs.reduce((acc, ref, i) => acc.replace(ref, `\u0001${i}\u0002`), text);
  const redacted = redactText(masked);
  const secret = containsSecret(redacted);
  const restored = refs.reduce((acc, ref, i) => acc.replace(`\u0001${i}\u0002`, ref), redacted);
  return { text: restored, secret };
}

/** Applies the secret rules to one diff line. */
function safeLine(line: string, removesSecret: boolean): string {
  if (line.startsWith("@@")) return cleanHunkHeader(line);
  if (line.startsWith("\\")) return line;
  const marker = line.slice(0, 1);
  if (removesSecret && marker === "-") return REMOVED_SECRET_LINE;
  const { text, secret } = redactKeepingEnvRefs(line.slice(1));
  return secret ? `${marker}   ${HIDDEN_LINE}` : `${marker}${text}`;
}

function renderFile(file: string, diff: FileDiff | undefined, removesSecret: boolean): string[] {
  const out = [`--- ${file}${diff?.isNew === true ? " (new file)" : ""}`];
  if (diff === undefined || diff.lines.length === 0) return [...out, "  (no changes)"];
  for (const line of diff.lines.slice(0, MAX_LINES_PER_FILE)) out.push(safeLine(line, removesSecret));
  const more = diff.lines.length - MAX_LINES_PER_FILE;
  if (more > 0) out.push(`... ${more} more line(s)`);
  return out;
}

/**
 * Human-readable preview of what a fix will change: a unified diff (1 line of context) per
 * edited file. It is printed to the terminal, so it never shows a secret: removed lines of a
 * `removesSecret` fix are hidden, and every printed line (context included) is redacted and
 * replaced if it still looks like a secret. Never throws.
 *
 * @param fix - The verified fix about to be offered to the user
 * @param projectRoot - The real project the edits would be written to
 * @returns Text ready to print (no trailing newline)
 */
export function formatFixPreview(fix: ProposedFix, projectRoot: string): string {
  let stage: string | undefined;
  try {
    stage = mkdtempSync(join(tmpdir(), "muraqib-agent-preview-"));
    applyEdits(stage, fix.edits);
    const files = fix.edits.map((e) => e.file);
    const patch = makePatch(projectRoot, stage, files, 1);
    const changed = fix.edits.some((e) => readIfExists(projectRoot, e.file) !== e.content);
    if (patch === "" && changed) return UNAVAILABLE;
    const blocks = splitDiff(patch);
    return files.flatMap((file) => renderFile(file, blocks.get(file), fix.removesSecret)).join("\n");
  } catch {
    return UNAVAILABLE;
  } finally {
    if (stage !== undefined) rmSync(stage, { recursive: true, force: true });
  }
}
