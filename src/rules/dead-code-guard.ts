import fs from "fs";
import path from "path";
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

/** Maps a built path from package.json (`./dist/foo.js`) back to its source file (`src/foo.ts`). */
function distToSource(value: string): string | undefined {
  const match = /^\.?\/?(?:dist|build|lib)\/(.+?)(?:\.d)?\.[cm]?[jt]s$/.exec(value);
  return match?.[1] ? `src/${match[1]}.ts` : undefined;
}

function collectPackageTargets(value: unknown, out: string[]): void {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => collectPackageTargets(v, out));
  else if (typeof value === "object" && value !== null) {
    Object.values(value as Record<string, unknown>).forEach((v) => collectPackageTargets(v, out));
  }
}

/** Source files declared as package entrypoints through `main`, `types`, `module` or `exports`. */
function readPackageEntrypoints(targetPath: string): Set<string> {
  const entries = new Set<string>();
  try {
    const pkg: unknown = JSON.parse(fs.readFileSync(path.join(targetPath, "package.json"), "utf-8"));
    if (typeof pkg !== "object" || pkg === null) return entries;
    const record = pkg as Record<string, unknown>;
    const targets: string[] = [];
    for (const key of ["main", "types", "module", "exports"]) collectPackageTargets(record[key], targets);
    for (const target of targets) {
      const source = distToSource(target);
      if (source) entries.add(source);
    }
  } catch {
    // no readable package.json: fall back to the index/barrel heuristics only
  }
  return entries;
}

/** Resolves `export * from "./x"` re-exports of a barrel to the relative source paths they publish. */
function resolveStarReExports(barrelPath: string, content: string, knownFiles: Set<string>): string[] {
  const resolved: string[] = [];
  const starRegex = /export\s+(?:type\s+)?\*(?:\s+as\s+\w+)?\s+from\s+["'](\.[^"']*)["']/g;
  let m: RegExpExecArray | null;
  while ((m = starRegex.exec(content)) !== null) {
    const base = path.posix.join(path.posix.dirname(barrelPath), (m[1] ?? "").replace(/\.[cm]?js$/, ""));
    for (const candidate of [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`]) {
      if (knownFiles.has(candidate)) resolved.push(candidate);
    }
  }
  return resolved;
}

function countOccurrences(content: string, name: string): number {
  const escaped = name.replace(/\$/g, "\\$");
  return (content.match(new RegExp(`(?<![\\w$])${escaped}(?![\\w$])`, "g")) ?? []).length;
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

const MAX_STATEMENT_LINES = 40;

const isBlankOrLineComment = (line: string): boolean => line === "" || line.startsWith("//");

/** `if (x)\n  return y;` has no braces: the jump only guards that branch, so nothing after it is dead. */
function isGuardedJump(lines: string[], index: number): boolean {
  let p = index - 1;
  while (p >= 0 && isBlankOrLineComment((lines[p] ?? "").trim())) p--;
  const previous = p >= 0 ? stripStringsAndComments(lines[p] ?? "").trim() : "";
  return previous.endsWith(")") || previous === "else" || previous.endsWith("=>");
}

/** Index of the line where the (possibly multi-line) jump statement starting at `start` ends, or -1. */
function jumpStatementEnd(lines: string[], start: number): number {
  let depth = 0;
  for (let j = start; j < Math.min(lines.length, start + MAX_STATEMENT_LINES); j++) {
    depth += bracketDelta(lines[j] ?? "");
    const code = stripStringsAndComments(lines[j] ?? "").trim();
    if (depth <= 0 && (code.endsWith(";") || /^(?:break|continue|return|throw)$/.test(code) || depth < 0)) {
      return depth < 0 ? -1 : j;
    }
  }
  return -1;
}

/** Index of the first line at or after `from` that is code (not blank or a comment). */
function nextCodeIndex(lines: string[], from: number): number {
  let n = from;
  while (n < lines.length) {
    const next = (lines[n] ?? "").trim();
    if (next !== "" && !next.startsWith("//") && !next.startsWith("*") && !next.startsWith("/*")) break;
    n++;
  }
  return n;
}

/** Whether `next` (the line after a jump) is normal code: a block end, `case`/`default`/`else`, or a hoisted function. */
function isReachableAfterJump(next: string): boolean {
  return (
    next === "" ||
    /^[}\])]/.test(next) ||
    /^(?:case\b|default\s*:|else\b)/.test(next) ||
    /^(?:async\s+)?function\b/.test(next)
  );
}

/**
 * Returns the 1-based line numbers of statements that sit directly after a complete
 * `return`/`throw`/`break`/`continue` statement inside the same block.
 * A closing brace, `case`, `default` or `else` after the jump is normal code, not dead code.
 */
export function findUnreachableLines(lines: string[]): number[] {
  const found: number[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (!JUMP_STATEMENT_REGEX.test((lines[i] ?? "").trim()) || isGuardedJump(lines, i)) continue;

    const end = jumpStatementEnd(lines, i);
    if (end === -1) continue;

    const n = nextCodeIndex(lines, end + 1);
    const next = n < lines.length ? (lines[n] ?? "").trim() : "";
    if (!isReachableAfterJump(next)) found.push(n + 1);
  }
  return found;
}

type ScannedFile = ReturnType<typeof scanProjectFiles>[number];

const toPosix = (relativePath: string): string => relativePath.replace(/\\/g, "/");

/** 1-based line of a character offset. */
const lineOf = (content: string, index: number): number => content.slice(0, index).split("\n").length;

/**
 * An export counts as used when its name appears in ANY other project file: sources, specs,
 * tests, bin scripts and plain JS consumers included (not only `import ... from` lines in src).
 */
function indexIdentifiers(targetPath: string): Map<string, Set<string>> {
  const identifiersByFile = new Map<string, Set<string>>();
  for (const consumer of scanProjectFiles(targetPath, ["ts", "tsx", "js", "mjs", "cjs"], { includeTests: true })) {
    identifiersByFile.set(consumer.path, new Set(consumer.content.match(IDENTIFIER_REGEX) ?? []));
  }
  return identifiersByFile;
}

/** Package entrypoints (and anything they `export *` from) are public API consumed outside the repo. */
function collectPublicFiles(targetPath: string, scannedFiles: ScannedFile[]): Set<string> {
  const knownFiles = new Set(scannedFiles.map((f) => toPosix(f.relativePath)));
  const publicFiles = readPackageEntrypoints(targetPath);
  for (const f of scannedFiles) {
    const rel = toPosix(f.relativePath);
    if (isEntryOrBarrel(rel) || publicFiles.has(rel)) {
      for (const reExported of resolveStarReExports(rel, f.content, knownFiles)) publicFiles.add(reExported);
    }
  }
  return publicFiles;
}

function reportEmptyFunctions({ relativePath, content }: ScannedFile, out: DeadCodeAuditResult): void {
  const emptyFuncRegex = /(?:function\s+(\w+)\s*\([^)]*\)|(\w+)\s*(?::\s*[^=]+)?=\s*(?:async\s*)?\([^)]*\)\s*=>)\s*{\s*}/g;
  let match: RegExpExecArray | null;
  while ((match = emptyFuncRegex.exec(content)) !== null) {
    const name = match[1] || match[2] || "anonymous";
    const lineNum = lineOf(content, match.index);
    out.emptyFunctions.push(`${relativePath}:${lineNum} (${name})`);
    out.reports.push(`Empty function body: ${relativePath}:${lineNum} — "${name}" does nothing`);
  }
}

function reportUnreachable({ relativePath, content }: ScannedFile, out: DeadCodeAuditResult): void {
  for (const lineNum of findUnreachableLines(content.split("\n"))) {
    out.unreachableBranches.push(`${relativePath}:${lineNum}`);
    out.reports.push(`Unreachable code: ${relativePath}:${lineNum} — statement follows return/throw/break/continue in the same block`);
  }
}

/**
 * Whether an exported name is accounted for: type-only exports that the file itself still uses are
 * part of the signature of its other declarations (public API shape), and any other file mentioning
 * the name counts as a consumer.
 */
function isExportUsed(
  file: ScannedFile,
  exportKind: string | undefined,
  exportedName: string,
  identifiersByFile: Map<string, Set<string>>
): boolean {
  if ((exportKind === "interface" || exportKind === "type") && countOccurrences(file.content, exportedName) > 1) {
    return true;
  }
  for (const [otherFile, identifiers] of identifiersByFile) {
    if (otherFile !== file.path && identifiers.has(exportedName)) return true;
  }
  return false;
}

function findUnusedExports(
  file: ScannedFile,
  identifiersByFile: Map<string, Set<string>>
): Array<{ name: string; line: number }> {
  const unused: Array<{ name: string; line: number }> = [];
  const exportRegex = /export\s+(?:async\s+)?(function|class|const|interface|type)\s+([A-Za-z_$][\w$]*)/g;
  let match: RegExpExecArray | null;
  while ((match = exportRegex.exec(file.content)) !== null) {
    const exportedName = match[2];
    if (!exportedName || exportedName === "default") continue;
    if (!isExportUsed(file, match[1], exportedName, identifiersByFile)) {
      unused.push({ name: exportedName, line: lineOf(file.content, match.index) });
    }
  }
  return unused;
}

/** One summary entry per file keeps unused-export noise from burying real findings. */
function reportUnusedExports(
  file: ScannedFile,
  publicFiles: Set<string>,
  identifiersByFile: Map<string, Set<string>>,
  out: DeadCodeAuditResult
): void {
  const { relativePath } = file;
  if (isEntryOrBarrel(relativePath) || publicFiles.has(toPosix(relativePath))) return;
  const unusedInFile = findUnusedExports(file, identifiersByFile);
  const [first] = unusedInFile;
  if (!first) return;
  const names = unusedInFile.map((e) => e.name).join(", ");
  out.unusedExports.push(`${relativePath}:${first.line} (${names})`);
  out.reports.push(
    `Potentially unused export${unusedInFile.length > 1 ? "s" : ""}: ${relativePath}:${first.line} — ${unusedInFile.length} not imported anywhere else (${names})`
  );
}

function performDeadCodeAuditInternal(targetPath: string): DeadCodeAuditResult {
  const out: DeadCodeAuditResult = { isClean: true, reports: [], emptyFunctions: [], unreachableBranches: [], unusedExports: [] };

  const scannedFiles = scanProjectFiles(targetPath, ["ts"]);
  const identifiersByFile = indexIdentifiers(targetPath);
  const publicFiles = collectPublicFiles(targetPath, scannedFiles);

  for (const file of scannedFiles) {
    if (file.content.includes("muraqib-ignore-dead") || file.content.includes("muraqib-unreachable")) continue;
    reportEmptyFunctions(file, out);
    reportUnreachable(file, out);
    reportUnusedExports(file, publicFiles, identifiersByFile, out);
  }

  out.isClean = out.reports.length === 0;
  return out;
}

export { performDeadCodeAuditInternal as performDeadCodeAudit };

/**
 * Dead code guard class.
 * Detects empty functions, unreachable branches and unused exports.
 * Severity levels used: warning.
 */
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