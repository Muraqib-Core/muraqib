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

const IDENTIFIER_REGEX = /[A-Za-z_$][\w$]*/g;
const JUMP_STATEMENT_REGEX = /^(?:return|throw|break|continue)\b/;

/** Public entry points and barrels are the package API: their exports are consumed outside the repo. */
function isEntryOrBarrel(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, "/");
  return normalized.startsWith("src/index") || /(^|\/)index\.[cm]?[jt]sx?$/.test(normalized) || normalized.startsWith("src/core/");
}

function stripStringsAndComments(line: string): string {
  return line
    .replace(/\/\/.*$/, "")
    .replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g, '""');
}

function bracketDelta(line: string): number {
  let delta = 0;
  for (const ch of stripStringsAndComments(line)) {
    if (ch === "(" || ch === "[" || ch === "{") delta++;
    else if (ch === ")" || ch === "]" || ch === "}") delta--;
  }
  return delta;
}

/**
 * Returns the 1-based line numbers of statements that sit directly after a complete
 * `return`/`throw`/`break`/`continue` statement inside the same block.
 * A closing brace, `case`, `default` or `else` after the jump is normal code, not dead code.
 */
export function findUnreachableLines(lines: string[]): number[] {
  const found: number[] = [];
  const MAX_STATEMENT_LINES = 40;

  for (let i = 0; i < lines.length; i++) {
    const line = (lines[i] ?? "").trim();
    if (!JUMP_STATEMENT_REGEX.test(line)) continue;

    // `if (x)\n  return y;` has no braces: the jump only guards that branch
    let p = i - 1;
    while (p >= 0 && ((lines[p] ?? "").trim() === "" || (lines[p] ?? "").trim().startsWith("//"))) p--;
    const previous = p >= 0 ? stripStringsAndComments(lines[p] ?? "").trim() : "";
    if (previous.endsWith(")") || previous === "else" || previous.endsWith("=>")) continue;

    // Find where the (possibly multi-line) statement ends
    let depth = 0;
    let end = -1;
    for (let j = i; j < Math.min(lines.length, i + MAX_STATEMENT_LINES); j++) {
      depth += bracketDelta(lines[j] ?? "");
      const code = stripStringsAndComments(lines[j] ?? "").trim();
      if (depth <= 0 && (code.endsWith(";") || /^(?:break|continue|return|throw)$/.test(code) || depth < 0)) {
        end = depth < 0 ? -1 : j;
        break;
      }
    }
    if (end === -1) continue;

    let n = end + 1;
    while (n < lines.length) {
      const next = (lines[n] ?? "").trim();
      if (next !== "" && !next.startsWith("//") && !next.startsWith("*") && !next.startsWith("/*")) break;
      n++;
    }
    const next = n < lines.length ? (lines[n] ?? "").trim() : "";
    if (next === "" || /^[}\])]/.test(next) || /^(?:case\b|default\s*:|else\b)/.test(next)) continue;
    if (/^(?:async\s+)?function\b/.test(next)) continue; // hoisted declarations stay reachable

    found.push(n + 1);
  }
  return found;
}

function performDeadCodeAuditInternal(targetPath: string): DeadCodeAuditResult {
  const reports: string[] = [];
  const emptyFunctions: string[] = [];
  const unreachableBranches: string[] = [];
  const unusedExports: string[] = [];

  const scannedFiles = scanProjectFiles(targetPath, ["ts"]);

  // An export counts as used when its name appears in ANY other project file: sources, specs,
  // tests, bin scripts and plain JS consumers included (not only `import ... from` lines in src).
  const identifiersByFile = new Map<string, Set<string>>();
  for (const consumer of scanProjectFiles(targetPath, ["ts", "tsx", "js", "mjs", "cjs"], { includeTests: true })) {
    identifiersByFile.set(consumer.path, new Set(consumer.content.match(IDENTIFIER_REGEX) ?? []));
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

    for (const lineNum of findUnreachableLines(lines)) {
      unreachableBranches.push(`${relativePath}:${lineNum}`);
      reports.push(`Unreachable code: ${relativePath}:${lineNum} — statement follows return/throw/break/continue in the same block`);
    }

    const exportRegex = /export\s+(?:async\s+)?(?:function|class|const|interface|type)\s+([A-Za-z_$][\w$]*)/g;
    while ((match = exportRegex.exec(content)) !== null) {
      const exportedName = match[1];
      if (!exportedName || exportedName === "default") continue;

      if (isEntryOrBarrel(relativePath)) {
        continue;
      }

      let usedElsewhere = false;
      for (const [otherFile, identifiers] of identifiersByFile) {
        if (otherFile !== filePath && identifiers.has(exportedName)) {
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