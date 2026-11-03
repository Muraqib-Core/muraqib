import { readFileSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import ignore from "ignore";
import type { AgentIssue } from "../agent/types.js";

/** Name of the project-root file that lists paths agent-v2 must not report or touch. */
export const IGNORE_FILE = ".muraqibignore" as const;
/** Inline marker: a line containing it is skipped by the agent-v2 secrets detector (same as the v1 hook). */
export const SECRET_MARKER = "muraqib-ignore-secret" as const;
/** Inline marker: a line containing it is skipped by the agent-v2 env-usage detector. */
export const ENV_MARKER = "muraqib-ignore-env" as const;

/** Tells whether a project-relative path is excluded by `.muraqibignore`. */
export type IgnoreMatcher = (file: string) => boolean;

/** Backslashes become `/` and a leading `./` is dropped, so Windows and POSIX paths behave alike. */
export function toPosixPath(file: string): string {
  let posix = file.split("\\").join("/");
  while (posix.startsWith("./")) posix = posix.slice(2);
  return posix;
}

/**
 * Loads `<projectRoot>/.muraqibignore` (gitignore syntax, handled by the `ignore` package; a UTF-8
 * BOM and CRLF line endings are accepted). Never throws.
 *
 * @param projectRoot - Project root folder
 * @returns A matcher, or `undefined` when the file is missing, unreadable or has no rules
 */
export function loadIgnoreMatcher(projectRoot: string): IgnoreMatcher | undefined {
  let text: string;
  try {
    text = readFileSync(join(projectRoot, IGNORE_FILE), "utf-8");
  } catch {
    return undefined;
  }
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  if (!lines.some((line) => line.trim() !== "" && !line.trimStart().startsWith("#"))) return undefined;
  const matcher = ignore();
  try {
    matcher.add(lines);
  } catch {
    return undefined;
  }
  return (file) => {
    const posix = toPosixPath(file);
    if (posix === "" || posix.startsWith("../") || isAbsolute(posix) || /^[A-Za-z]:/.test(posix)) return false;
    try {
      return matcher.ignores(posix);
    } catch {
      return false;
    }
  };
}

function relativeToRoot(projectRoot: string, file: string): string {
  return isAbsolute(file) ? relative(projectRoot, file) : file;
}

/**
 * Drops the issues whose file is excluded by `.muraqibignore`. Issues without a file are kept.
 * Order is preserved. With no ignore file the list is returned unchanged.
 *
 * @param projectRoot - Project root folder holding `.muraqibignore`
 * @param issues - Issues from any module
 * @returns The issues that are not ignored
 */
export function filterIgnoredIssues(projectRoot: string, issues: readonly AgentIssue[]): AgentIssue[] {
  const matcher = loadIgnoreMatcher(projectRoot);
  if (matcher === undefined) return [...issues];
  return issues.filter((issue) => issue.file === undefined || !matcher(relativeToRoot(projectRoot, issue.file)));
}

/** Blanks every line containing `marker` (line numbers are preserved) so detectors never see it. */
export function blankMarkedLines(content: string, marker: string): string {
  if (!content.includes(marker)) return content;
  return content
    .split("\n")
    .map((line) => (line.includes(marker) ? "" : line))
    .join("\n");
}
