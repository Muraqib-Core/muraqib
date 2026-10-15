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
  /** Structured findings, one per entry in `reports` (same order), with file and line. */
  findings: AsyncFinding[];
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

/** Files that implement the audit itself: they quote the patterns they look for. */
const SELF_SKIP = /(?:^|\/)core\/(?:async|security)-guard(?:\.|$)/;

/** A structured async finding. `code` is stable and never derived from the file path or message. */
export interface AsyncFinding { // muraqib-ignore-dead: structured finding shape of AsyncAuditResult
  code: string;
  severity: "critical" | "error" | "warning" | "info";
  message: string;
  file?: string;
  line?: number;
}

/** Previous line ends mid-expression, so the next line is not a statement of its own. */
const CONTINUATION_END = /(?:[=(,?:|&+\-<>!]|\b(?:return|await|void|yield|else|typeof))$/;

/** Statement that is a bare promise-returning call: `fetch(`, `axios(`, `axios.get(`, `window.fetch(`, `query(`. */
const FLOATING_START = /^(?:(?:window|globalThis|self)\.)?(?:fetch|request|query)\s*\(|^axios(?:\.[A-Za-z_$][\w$]*)?\s*\(/;

/** Method/function declaration header such as `query(sql: string): Row[] {`. */
const DECLARATION_END = /\)\s*(?::\s*[^=;{]+)?\s*\{\s*$/;

/** Names of async functions and of async methods/properties declared in (masked) `source`. */
function collectAsyncNames(source: string): { functions: Set<string>; methods: Set<string> } {
  const functions = new Set<string>();
  const methods = new Set<string>();
  for (const match of source.matchAll(/\basync\s+function\s*\*?\s*([A-Za-z_$][\w$]*)/g)) {
    if (match[1] !== undefined) functions.add(match[1]);
  }
  for (const match of source.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*async\b/g)) {
    if (match[1] !== undefined) functions.add(match[1]);
  }
  for (const match of source.matchAll(/^[ \t]*(?:(?:public|private|protected|static|override|readonly)\s+)*async\s+([A-Za-z_$][\w$]*)\s*[(<]/gm)) {
    if (match[1] !== undefined && match[1] !== "function") methods.add(match[1]);
  }
  for (const match of source.matchAll(/^[ \t]*(?:(?:public|private|protected|static|override|readonly)\s+)*([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*async\b/gm)) {
    if (match[1] !== undefined) methods.add(match[1]);
  }
  return { functions, methods };
}

function performAsyncAuditInternal(targetPath: string): AsyncAuditResult {
  const findings: AsyncFinding[] = [];
  const unhandledPromises: string[] = [];
  const missingAwait: string[] = [];
  const callbackHell: string[] = [];
  const floatingPromises: string[] = [];

  // Only scan TypeScript sources to avoid false-positives from compiled JS artifacts.
  const scannedFiles = scanProjectFiles(targetPath, ["ts"]);

  for (const scannedFile of scannedFiles) {
    const { relativePath } = scannedFile;
    // Skip scanning the guard and related guards themselves to avoid self-matching callback patterns
    if (SELF_SKIP.test(relativePath.replace(/\\/g, "/"))) continue;
    // Strings, template text and comments are data, not executed code (e.g. a browser script
    // embedded in a template literal); mask them so only real statements are inspected.
    const content = maskLiteralsAndComments(scannedFile.content);
    const lines = content.split("\n");
    const asyncNames = collectAsyncNames(content);
    let lineStart = 0;
    let previous = "";

    const add = (code: string, severity: AsyncFinding["severity"], lineNum: number, message: string): void => {
      findings.push({ code, severity, message, file: relativePath, line: lineNum });
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const offset = lineStart;
      lineStart += (line?.length ?? 0) + 1;
      if (line === undefined) continue;
      const lineNum = i + 1;
      const trimmed = line.trim();
      const isContinuation = CONTINUATION_END.test(previous);
      if (trimmed.length > 0) previous = trimmed;
      if (trimmed.length === 0) continue;
      const nextWindow = lines.slice(i, Math.min(i + 5, lines.length)).join(" ");

      if (/new\s+Promise\s*\(/.test(trimmed) && !FULFIL_ONLY_EXECUTOR.test(trimmed) && !nextWindow.includes(".catch(")) {
        unhandledPromises.push(`${relativePath}:${lineNum}`);
        add("ASYNC_UNHANDLED_PROMISE", "error", lineNum, `Unhandled Promise at ${relativePath}:${lineNum} — add .catch() or try/catch`);
      }

      // Missing await: a statement that is only `name();` / `this.name();` for an async function in this file.
      const callMatch = /^(this\.)?([A-Za-z_$][\w$]*)\s*\(\s*\)\s*;?$/.exec(trimmed);
      if (callMatch?.[2] !== undefined && !isContinuation) {
        const funcName = callMatch[2];
        const isAsync = callMatch[1] === undefined ? asyncNames.functions.has(funcName) : asyncNames.methods.has(funcName);
        if (isAsync) {
          missingAwait.push(`${relativePath}:${lineNum}`);
          add("ASYNC_MISSING_AWAIT", "warning", lineNum, `Missing await for async call: ${relativePath}:${lineNum} — ${funcName}() returns a Promise`);
        }
      }

      const callbackDepth = (trimmed.match(/\)/g) ?? []).length;
      if (callbackDepth >= 3 && (trimmed.includes("callback") || /\bcb\b/.test(trimmed))) {
        callbackHell.push(`${relativePath}:${lineNum}`);
        add("ASYNC_CALLBACK_HELL", "warning", lineNum, `Potential callback hell: ${relativePath}:${lineNum} — consider async/await`);
      }

      // Floating promise: the statement itself starts with the call (so never `const x = fetch(`,
      // `return`, `await`, `void`, `.then(` ...), is not a method declaration and is not chained.
      if (FLOATING_START.test(trimmed) && !isContinuation && !DECLARATION_END.test(trimmed) && !trimmed.includes(".catch(")) {
        const following = lines.slice(i + 1).find((candidate) => candidate.trim().length > 0)?.trim() ?? "";
        if (!/^\.(?:then|catch|finally)\b/.test(following)) {
          floatingPromises.push(`${relativePath}:${lineNum}`);
          add("ASYNC_FLOATING_PROMISE", "error", lineNum, `Floating Promise: ${relativePath}:${lineNum} — Promise result is ignored`);
        }
      }

      if (trimmed.includes(".then(") && !nextWindow.includes(".catch(") && !chainHandlesRejection(content, offset + line.indexOf(".then("))) {
        add("ASYNC_THEN_WITHOUT_CATCH", "warning", lineNum, `Promise chain without .catch(): ${relativePath}:${lineNum}`);
      }
    }
  }

  return {
    isClean: findings.length === 0,
    reports: findings.map((finding) => finding.message),
    unhandledPromises,
    missingAwait,
    callbackHell,
    floatingPromises,
    findings,
  };
}

/**
 * Detects floating promises, missing `await`, and callback-hell patterns in source files.
 * Severity levels used: warning, error.
 */
export class AsyncGuard extends BaseGuard {
  private options: AsyncAuditOptions;

  constructor(options: AsyncAuditOptions, context?: AuditContext) {
    super("async-guard", context);
    this.options = options;
  }

  /**
   * Execute.
   *
   * @returns Execute result
   */
  async execute(): Promise<AuditResult> {
    const result = performAsyncAuditInternal(this.options.targetPath);

    const issues: AuditIssue[] = [];

    for (const finding of result.findings) {
      issues.push(
        this.createIssue(
          finding.code,
          finding.severity,
          "Async Pattern Issue",
          finding.message,
          finding.file === undefined ? undefined : { file: finding.file, ...(finding.line === undefined ? {} : { line: finding.line }) },
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