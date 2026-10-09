import { BaseGuard } from "../core/base-guard.js";
import type { AuditResult, AuditIssue, AuditContext } from "../core/types.js";
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

function performDeadCodeAuditInternal(targetPath: string): DeadCodeAuditResult {
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

export { performDeadCodeAuditInternal as performDeadCodeAudit };

export class DeadCodeGuard extends BaseGuard {
  private targetPath: string;

  constructor(targetPath: string, context?: AuditContext) {
    super('dead-code-guard', context);
    this.targetPath = targetPath;
  }

  async execute(): Promise<AuditResult> {
    const result = performDeadCodeAuditInternal(this.targetPath);
    const issues: AuditIssue[] = [];

    for (const emptyFunc of result.emptyFunctions) {
      issues.push(
        this.createIssue(
          'EMPTY_FUNCTION',
          'warning',
          'Empty Function Detected',
          `Dead code detected: ${emptyFunc}`,
          undefined,
          'Remove unused functions or add implementation',
          ['dead-code', 'code-quality']
        )
      );
    }

    for (const unreachable of result.unreachableBranches) {
      issues.push(
        this.createIssue(
          'UNREACHABLE_CODE',
          'warning',
          'Unreachable Code',
          `Code after control flow statement: ${unreachable}`,
          undefined,
          'Remove or refactor unreachable code paths',
          ['dead-code', 'control-flow']
        )
      );
    }

    for (const unused of result.unusedExports) {
      issues.push(
        this.createIssue(
          'UNUSED_EXPORT',
          'info',
          'Potentially Unused Export',
          `Export not used elsewhere: ${unused}`,
          undefined,
          'Remove if truly unused or import in dependent modules',
          ['dead-code', 'exports']
        )
      );
    }

    const status = result.isClean ? 'ok' : 'warning';
    return this.createResult(
      status,
      issues,
      status === 'ok'
        ? '✅ No dead code detected'
        : `⚠️ Found ${result.reports.length} potential dead code issues`
    );
  }
}