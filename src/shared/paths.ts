import path from "node:path";

/**
 * Converts a platform-specific path to forward slashes, for stable comparison and reporting.
 *
 * @param value - Path using `path.sep` or backslashes
 * @returns The same path with `/` separators
 */
export function toPosix(value: string): string {
  return value.split(path.sep).join("/").replace(/\\/g, "/");
}

/**
 * Whether `target` is `root` itself or lies inside it (lexically, symlinks are not resolved).
 *
 * @param root - Directory that must contain the target
 * @param target - Absolute or relative path to check
 * @returns True when the target does not escape the root
 */
export function isWithinRoot(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}
