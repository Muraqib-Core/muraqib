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

  // Package entrypoints (and anything they `export *` from) are public API consumed outside the repo.
  const knownFiles = new Set(scannedFiles.map((f) => f.relativePath.replace(/\\/g, "/")));
  const publicFiles = readPackageEntrypoints(targetPath);
  for (const f of scannedFiles) {
    const rel = f.relativePath.replace(/\\/g, "/");
    if (isEntryOrBarrel(rel) || publicFiles.has(rel)) {
      for (const reExported of resolveStarReExports(rel, f.content, knownFiles)) publicFiles.add(reExported);
    }
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

    const isPublicFile = isEntryOrBarrel(relativePath) || publicFiles.has(relativePath.replace(/\\/g, "/"));
    const unusedInFile: Array<{ name: string; line: number }> = [];
    const exportRegex = /export\s+(?:async\s+)?(function|class|const|interface|type)\s+([A-Za-z_$][\w$]*)/g;
    while ((match = exportRegex.exec(content)) !== null) {
      const exportKind = match[1];
      const exportedName = match[2];
      if (!exportedName || exportedName === "default") continue;

      if (isPublicFile) {
        continue;
      }

      // A type-only export that the file itself still uses is part of the signature of its
      // other declarations (public API shape), not dead code.
      if ((exportKind === "interface" || exportKind === "type") && countOccurrences(content, exportedName) > 1) {
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
        unusedInFile.push({ name: exportedName, line: lineNum });
      }
    }

    // One summary entry per file keeps unused-export noise from burying real findings.
    const [first] = unusedInFile;
    if (first) {
      const names = unusedInFile.map((e) => e.name).join(", ");
      unusedExports.push(`${relativePath}:${first.line} (${names})`);
      reports.push(
        `Potentially unused export${unusedInFile.length > 1 ? "s" : ""}: ${relativePath}:${first.line} — ${unusedInFile.length} not imported anywhere else (${names})`
      );
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