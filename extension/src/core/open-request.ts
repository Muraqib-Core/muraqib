import type { WebviewToHostMessage } from "./messages.js";
import { resolveExistingFileInside, type PathApi, type PathIo } from "./path-safety.js";
import * as nodePath from "node:path";

/** A validated request to reveal a file location. */
export interface OpenTarget {
  /** Absolute, symlink-resolved path inside the workspace. */
  path: string;
  /** One-based line. */
  line: number;
  /** One-based column. */
  column: number;
}

/**
 * Decide whether the host may open the file a webview asked for. Three independent checks must
 * pass: the path was named by the last report, it stays inside the workspace after symlink
 * resolution, and it is an existing regular file. Returns `undefined` otherwise.
 */
export async function resolveOpenRequest(
  message: Extract<WebviewToHostMessage, { type: "openFile" }>,
  root: string | undefined,
  reportedFiles: ReadonlySet<string>,
  io: PathIo,
  api: PathApi = nodePath
): Promise<OpenTarget | undefined> {
  if (root === undefined || !reportedFiles.has(message.file)) return undefined;
  const path = await resolveExistingFileInside(root, message.file, io, api);
  if (path === undefined) return undefined;
  return { path, line: message.line ?? 1, column: message.column ?? 1 };
}
