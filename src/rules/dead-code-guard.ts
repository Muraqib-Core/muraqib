import { scanProjectFiles } from "../utils/file-scanner.js";

/**
 * Result of a dead code audit
 * @interface DeadCodeAuditResult
 */
export interface DeadCodeAuditResult {
  isClean: boolean;
  reports: string[];
  emptyFunctions: string[];
  unreachableBranches: string[];
  unusedExports: string[];
}

/**
 * Performs a comprehensive dead code analysis on a project.
 * Detects empty functions, unreachable code paths, and unused exports.
 * Respects muraqib-ignore-dead and muraqib-unreachable suppression comments.
 *
 * @param targetPath - Root directory path to scan
 * @returns DeadCodeAuditResult with detailed reports on detected issues
 * @example
 * const result = performDeadCodeAudit('./src');
 * if (!result.isClean) console.log(result.reports);
 */
export function performDeadCodeAudit(targetPath: string): DeadCodeAuditResult {
  const reports: string[] = [];
  const emptyFunctions: string[] = [];
  const unreachableBranches: string[] = [];
  const unusedExports: string[] = [];

  const scannedFiles = scanProjectFiles(targetPath, ["ts"]);
  const fileContents = new Map<string, string>();
  for (const scannedFile of scannedFiles) {
    fileContents.set(scannedFile.path, scannedFile.content);
  }

  for (const scannedFile of scannedFiles) {
    const { path: filePath, relativePath, content } = scannedFile;
    if (content.includes("muraqib-ignore-dead") || content.includes("muraqib-unreachable")) {
      continue;
    }

    const lines = content.split("\n");

    const emptyFuncRegex = /(?:function\s+(\w+)\s*\([^)]*\)|(\w+)\s*(?::\s*[^=]+)?=\s*(?:async\s*)?\([^)]*\)\s*=>)\s*{\s*}/g;
    let match: RegExpExecArray | null;
    while ((match = emptyFuncRegex.exec(content)) !== null) {
      const name = match[1] || match[2] || "anonymous";
      const lineNum = content.slice(0, match.index).split("\n").length;
      emptyFunctions.push(`${relativePath}:${lineNum} (${name})`);
      reports.push(`Empty function body: ${relativePath}:${lineNum} — "${name}" does nothing`);
    }

    for (let i = 0; i < lines.length - 1; i++) {
      const currentLine = lines[i];
      const followingLine = lines[i + 1];
      if (currentLine === undefined || followingLine === undefined) continue;

      const line = currentLine.trim();
      const nextLine = followingLine.trim();

      const endsControlFlow = /^(return|throw)\b.*;?$/.test(line) || /^(break|continue);?$/.test(line);
      const lineIsBlockBoundary = nextLine === "}" || nextLine === "else" || nextLine.startsWith("else ") || nextLine.startsWith("case ") || nextLine.startsWith("default:");
      const nextIsMeaningful =
        nextLine.length > 0 &&
        nextLine !== "}" &&
        !nextLine.startsWith("//") &&
        !nextLine.startsWith("*") &&
        !nextLine.startsWith("/*") &&
        !nextLine.startsWith("case ") &&
        !nextLine.startsWith("default:");

      if (endsControlFlow && lineIsBlockBoundary) {
        unreachableBranches.push(`${relativePath}:${i + 2}`);
        reports.push(`Unreachable code: ${relativePath}:${i + 2} — appears right after a "${line.split(/\s+/)[0]}" statement`);
      }

      if (endsControlFlow && nextIsMeaningful && (line.includes("if (") || line.includes("for (") || line.includes("while ("))) {
        continue;
      }
    }

    const exportRegex = /export\s+(?:async\s+)?(?:function|class|const|interface|type)\s+([A-Za-z_$][\w$]*)/g;
    while ((match = exportRegex.exec(content)) !== null) {
      const exportedName = match[1];
      if (!exportedName || exportedName === "default") continue;

      const reExportFile = relativePath.startsWith("src/index") || relativePath.includes("/index.") || relativePath.startsWith("src/core/");
      if (reExportFile) {
        continue;
      }

      let usedElsewhere = false;
      for (const [otherFile, otherContent] of fileContents) {
        if (otherFile === filePath) continue;
        const importUsageRegex = new RegExp(`import\\s+[^;]*\\b${exportedName}\\b[^;]*from`, "m");
        if (importUsageRegex.test(otherContent)) {
          usedElsewhere = true;
          break;
        }
      }

      if (!usedElsewhere) {
        const lineNum = content.slice(0, match.index).split("\n").length;
        unusedExports.push(`${relativePath}:${lineNum} (${exportedName})`);
        reports.push(`Potentially unused export: ${relativePath}:${lineNum} — "${exportedName}" is not imported anywhere else`);
      }
    }
  }

  return {
    isClean: reports.length === 0,
    reports,
    emptyFunctions,
    unreachableBranches,
    unusedExports,
  };
}