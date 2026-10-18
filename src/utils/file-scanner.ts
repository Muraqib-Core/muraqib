import fs from "fs";
import path from "path";
import { globSync } from "glob";

/**
 * FileScanner: shared helper for reading and searching project files,
 * so the audits do not each re-implement file discovery with glob.
 */
export interface ScannedFile { // muraqib-ignore-dead: auto-suppressed by script for ScannedFile
  path: string;
  relativePath: string;
  content: string;
}

export interface ScanOptions {
  /** Also read spec files and the `tests/` folder (used to find where an export is consumed). */
  includeTests?: boolean;
}

/** Ignored at any depth, so nested `node_modules` of a monorepo workspace are skipped too. */
const ALWAYS_IGNORED = ["**/node_modules/**", "**/dist/**", "**/coverage/**", "**/*.d.ts"];
const TEST_IGNORED = ["tests/**", "**/*.spec.ts"];

/**
 * Reads the project's source files matching the given extensions.
 * Files that cannot be read (broken symlink, permissions, deleted mid-scan) are skipped
 * instead of aborting the whole audit.
 *
 * @param targetPath - Project root
 * @param fileExtensions - Extensions without the dot, e.g. `["ts", "js"]`
 * @param options - Scan options
 * @returns The readable files with their content
 */
export function scanProjectFiles(
  targetPath: string,
  fileExtensions: string[] = ["ts", "js"],
  options: ScanOptions = {}
): ScannedFile[] {
  const pattern = fileExtensions.length === 1 ? `**/*.${fileExtensions[0]}` : `**/*.{${fileExtensions.join(",")}}`;

  const files = globSync(pattern, {
    cwd: targetPath,
    absolute: true,
    ignore: options.includeTests ? ALWAYS_IGNORED : [...ALWAYS_IGNORED, ...TEST_IGNORED],
  });

  const scannedFiles: ScannedFile[] = [];

  for (const file of files) {
    let content: string;
    try {
      content = fs.readFileSync(file, "utf-8");
    } catch {
      continue;
    }
    scannedFiles.push({ path: file, relativePath: path.relative(targetPath, file), content });
  }

  return scannedFiles;
}
