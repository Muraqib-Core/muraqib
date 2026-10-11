/**
 * AsyncAudit: أداة فحص ذكية لمراقبة العمليات غير المتزامنة (Asynchronous Operations).
 * تعتمد على الـ file-scanner المشترك لضمان معمارية نظيفة وخالية من التكرار.
 */
import { maskLiteralsAndComments } from "../utils/code-mask.js";
import { scanProjectFiles } from "../utils/file-scanner.js";
import { BaseGuard } from "./base-guard.js";
import type { AuditResult, AuditIssue, AuditContext } from "./types.js";

export interface AsyncAuditResult { // muraqib-ignore-dead: auto-suppressed by script for AsyncAuditResult
  isClean: boolean;
  reports: string[];
  unhandledPromises: string[];
  missingAwait: string[];
  callbackHell: string[];
  floatingPromises: string[];
}

interface AsyncAuditOptions {
  targetPath: string;
}

/** `new Promise((resolve) => ...)`: an executor without a `reject` parameter can only fulfil. */
const FULFIL_ONLY_EXECUTOR = /new\s+Promise\s*\(\s*(?:async\s+)?(?:\(\s*\w+\s*\)|\w+)\s*=>|new\s+Promise\s*\(\s*(?:async\s+)?function\s*\w*\s*\(\s*\w+\s*\)/;

/** Index of the `)` matching the `(` at `open`, or -1. Expects literals/comments already masked. */
function findClosingParen(source: string, open: number): number {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const ch = source.charAt(i);
    if (ch === "(") depth++;
    else if (ch === ")" && --depth === 0) return i;
  }
  return -1;
}

/** True when `args` has a top-level comma, e.g. `onFulfilled, onRejected`. */
function hasTopLevelComma(args: string): boolean {
  let depth = 0;
  for (const ch of args) {
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
    else if (ch === "," && depth === 0) return true;
  }
  return false;
}

/**
 * Whether the `.then(` at `thenIndex` handles rejection: it passes an `onRejected` argument or
 * its chain (`.then().finally()...`) continues into a `.catch(`, however many lines it spans.
 */
function chainHandlesRejection(source: string, thenIndex: number): boolean {
  let position = thenIndex;
  for (;;) {
    const open = source.indexOf("(", position);
    const close = open === -1 ? -1 : findClosingParen(source, open);
    if (close === -1) return false;
    if (hasTopLevelComma(source.slice(open + 1, close))) return true;
    const next = /^\s*\.(then|catch|finally)(?=\s*\()/.exec(source.slice(close + 1));
    if (next === null) return false;
    if (next[1] === "catch") return true;
    position = close + 1 + next[0].length;
  }
}

function performAsyncAuditInternal(targetPath: string): AsyncAuditResult {
  const reports: string[] = [];
  const unhandledPromises: string[] = [];
  const missingAwait: string[] = [];
  const callbackHell: string[] = [];
  const floatingPromises: string[] = [];

  // Only scan TypeScript sources to avoid false-positives from compiled JS artifacts.
  const scannedFiles = scanProjectFiles(targetPath, ["ts"]);

  for (const scannedFile of scannedFiles) {
    const { relativePath } = scannedFile;
    // Strings, template text and comments are data, not executed code (e.g. a browser script
    // embedded in a template literal); mask them so only real statements are inspected.
    const content = maskLiteralsAndComments(scannedFile.content);
    // Skip scanning the guard and related guards themselves to avoid self-matching callback patterns
    if (/core[\\/]async-guard/.test(relativePath) || /core[\\/]security-guard/.test(relativePath)) {
      continue;
    }
    const lines = content.split("\n");
    let lineStart = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const offset = lineStart;
      lineStart += (line?.length ?? 0) + 1;
      if (line === undefined) continue;
      const lineNum = i + 1;
      const trimmed = line.trim();
      const nextWindow = lines.slice(i, Math.min(i + 5, lines.length)).join(" ");

      if (/new\s+Promise\s*\(/.test(trimmed) && !FULFIL_ONLY_EXECUTOR.test(trimmed) && !nextWindow.includes(".catch(")) {
        unhandledPromises.push(`${relativePath}:${lineNum}`);
        reports.push(`Unhandled Promise at ${relativePath}:${lineNum} — add .catch() or try/catch`);
      }

      const asyncCallMatch = trimmed.match(/([A-Za-z_$][\w$]*)\s*\(\s*\)\s*;?\s*$/);
      if (asyncCallMatch && asyncCallMatch[1]) {
        const funcName = asyncCallMatch[1];
        const funcDeclRegex = new RegExp(`(?:async\\s+function|const\\s+${funcName}\\s*=\\s*async)\\s+${funcName}`);
        const functionExists = funcDeclRegex.test(content);
        if (functionExists && !trimmed.includes("await") && !trimmed.includes("return") && !trimmed.startsWith("if ") && !trimmed.startsWith("for ") && !trimmed.startsWith("while ")) {
          missingAwait.push(`${relativePath}:${lineNum}`);
          reports.push(`Missing await for async call: ${relativePath}:${lineNum} — ${funcName}() returns a Promise`);
        }
      }

      const callbackDepth = (trimmed.match(/\)/g) || []).length;
      if (callbackDepth >= 3 && (trimmed.includes("callback") || /\bcb\b/.test(trimmed))) {
        callbackHell.push(`${relativePath}:${lineNum}`);
        reports.push(`Potential callback hell: ${relativePath}:${lineNum} — consider async/await`);
      }

      if (/\b(?:fetch|axios|request|query)\s*\(/.test(trimmed) && !trimmed.includes("await") && !trimmed.includes("return") && !trimmed.startsWith("const ") && !trimmed.startsWith("let ") && !trimmed.startsWith("var ") && !trimmed.startsWith("if ") && !trimmed.startsWith("for ")) {
        floatingPromises.push(`${relativePath}:${lineNum}`);
        reports.push(`Floating Promise: ${relativePath}:${lineNum} — Promise result is ignored`);
      }

      if (trimmed.includes(".then(") && !nextWindow.includes(".catch(") && !chainHandlesRejection(content, offset + line.indexOf(".then("))) {
        reports.push(`Promise chain without .catch(): ${relativePath}:${lineNum}`);
      }
    }
  }

  return {
    isClean: reports.length === 0,
    reports,
    unhandledPromises,
    missingAwait,
    callbackHell,
    floatingPromises,
  };
}

export class AsyncGuard extends BaseGuard {
  private options: AsyncAuditOptions;

  constructor(options: AsyncAuditOptions, context?: AuditContext) {
    super("async-guard", context);
    this.options = options;
  }

  async execute(): Promise<AuditResult> {
    const result = performAsyncAuditInternal(this.options.targetPath);

    const issues: AuditIssue[] = [];

    for (const report of result.reports) {
      let severity: AuditIssue["severity"] = "warning";
      if (report.includes("Unhandled Promise") || report.includes("Floating Promise")) {
        severity = "error";
      }

      issues.push(
        this.createIssue(
          `ASYNC_${report.split(":")[0]?.toUpperCase().replace(/\s+/g, "_") || "UNKNOWN"}`,
          severity,
          "Async Pattern Issue",
          report,
          undefined,
          "Use async/await and proper error handling"
        )
      );
    }

    if (issues.length === 0) {
      return this.ok("No async/await issues detected");
    }

    return this.issues(issues, `Found ${issues.length} async issue(s)`);
  }
}

/**
 * @deprecated Use AsyncGuard class instead
 */
export function performAsyncAudit(targetPath: string): AsyncAuditResult {
  return performAsyncAuditInternal(targetPath);
}