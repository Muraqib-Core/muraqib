import { cpSync, mkdirSync, mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { FileEdit } from "./types.js";

/** Folders never copied: dependencies, VCS data and build output are irrelevant to an audit of source. */
const SKIPPED_DIRS: ReadonlySet<string> = new Set(["node_modules", ".git", "dist", "coverage", ".muraqib-agent"]);

/** Copies a project into a fresh temp folder (skipping heavy folders). Remove it with {@link removeCopy}. */
export function copyProject(projectRoot: string): string {
  const root = mkdtempSync(join(tmpdir(), "muraqib-agent-copy-"));
  cpSync(projectRoot, root, {
    recursive: true,
    filter: (source) => !SKIPPED_DIRS.has(source.split(sep).pop() ?? ""),
  });
  return root;
}

export function removeCopy(root: string): void {
  rmSync(root, { recursive: true, force: true });
}

/** Resolves a project-relative path and refuses anything that escapes the root. */
export function resolveInside(root: string, file: string): string {
  if (isAbsolute(file)) throw new Error(`Edit path must be relative: ${file}`);
  const target = resolve(root, file);
  const rel = relative(resolve(root), target);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) throw new Error(`Edit path escapes the project: ${file}`);
  return target;
}

/** Writes the edits under `root`, creating folders as needed. */
export function applyEdits(root: string, edits: readonly FileEdit[]): void {
  for (const edit of edits) {
    const target = resolveInside(root, edit.file);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, edit.content, "utf-8");
  }
}

/** File content or undefined when it does not exist. */
export function readIfExists(root: string, file: string): string | undefined {
  const target = resolveInside(root, file);
  return existsSync(target) ? readFileSync(target, "utf-8") : undefined;
}
