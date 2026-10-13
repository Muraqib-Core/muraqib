import * as nodePath from "node:path";
import { isSafePathString } from "./messages.js";

/** The subset of `node:path` used for containment checks; swap in `path.win32` to test Windows rules. */
export type PathApi = Pick<typeof nodePath.posix, "resolve" | "relative" | "isAbsolute" | "sep">;

/**
 * Resolve `candidate` (relative to `root`, or absolute) and return the absolute path only when it
 * lies strictly inside `root`. Rejects traversal (`../`), other roots/drives, NUL bytes,
 * empty strings and the root itself. Purely lexical: see {@link resolveExistingFileInside}
 * for the symlink-aware variant.
 */
export function resolveInsideRoot(root: string, candidate: string, api: PathApi = nodePath): string | undefined {
  if (!isSafePathString(candidate) || !isSafePathString(root)) return undefined;
  const absoluteRoot = api.resolve(root);
  const absolute = api.resolve(absoluteRoot, candidate);
  const rel = api.relative(absoluteRoot, absolute);
  if (rel === "" || rel === ".." || rel.startsWith(`..${api.sep}`) || api.isAbsolute(rel)) return undefined;
  return absolute;
}

/** Filesystem access needed for symlink-aware checks; injected so tests need no real files. */
export interface PathIo {
  /** Resolve symlinks; must reject when the path does not exist. */
  realpath(path: string): Promise<string>;
  /** True when the path is a regular file (after following links). */
  isFile(path: string): Promise<boolean>;
}

/**
 * Like {@link resolveInsideRoot} but also follows symlinks, so a link inside the workspace that
 * points outside it is rejected. Returns `undefined` for missing files and directories.
 */
export async function resolveExistingFileInside(
  root: string,
  candidate: string,
  io: PathIo,
  api: PathApi = nodePath
): Promise<string | undefined> {
  const lexical = resolveInsideRoot(root, candidate, api);
  if (lexical === undefined) return undefined;
  try {
    const [realRoot, realTarget] = await Promise.all([io.realpath(root), io.realpath(lexical)]);
    if (resolveInsideRoot(realRoot, realTarget, api) === undefined) return undefined;
    return (await io.isFile(realTarget)) ? realTarget : undefined;
  } catch {
    return undefined;
  }
}
