import fs from "fs";
import path from "path";
import { globSync } from "glob";

/**
 * FileScanner: أداة مركزية لقراءة ملفات المشروع والبحث فيها.
 * الهدف: منع تكرار كود قراءة الملفات واستخدام الـ glob عبر أدوات الفحص المختلفة.
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

/**
 * Scan project files.
 *
 * @param targetPath - Target path
 * @param fileExtensions - File extensions
 * @param options - Options
 * @returns Scan project files result
 */
export function scanProjectFiles(
  targetPath: string,
  fileExtensions: string[] = ["ts", "js"],
  options: ScanOptions = {}
): ScannedFile[] {
  // بناء نمط البحث ديناميكياً بناءً على الامتدادات المطلوبة
  const pattern = fileExtensions.length === 1 ? `**/*.${fileExtensions[0]}` : `**/*.{${fileExtensions.join(",")}}`;
  
  // استثناء المجلدات غير المرغوبة
  const files = globSync(pattern, {
    cwd: targetPath,
    absolute: true,
    ignore: options.includeTests
      ? ["node_modules/**", "dist/**", "coverage/**", "**/*.d.ts"]
      : ["node_modules/**", "dist/**", "tests/**", "**/*.spec.ts", "**/*.d.ts"],
  });

  const scannedFiles: ScannedFile[] = [];

  for (const file of files) {
    const content = fs.readFileSync(file, "utf-8");
    const relativePath = path.relative(targetPath, file);
    scannedFiles.push({
      path: file,
      relativePath,
      content,
    });
  }

  return scannedFiles;
}