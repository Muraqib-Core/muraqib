import { maskLiteralsAndComments } from "../../../utils/code-mask.js";
import type { FixClass, PlanStep } from "../../types.js";
import { readIfExists } from "../project-copy.js";
import type { FixContext, FixDecision, Fixer, FixerResult, ProposedFix } from "../types.js";

/** v1 async-guard codes this fixer understands. */
const SUPPORTED_CODES: ReadonlySet<string> = new Set(["ASYNC_FLOATING_PROMISE", "ASYNC_MISSING_AWAIT"]);
const CATCH_SUFFIX = ".catch((error: unknown) => { console.error(error); })";
const OPENERS = "([{";
const CLOSERS = ")]}";

/** A statement located in the source. Offsets are into the original text (masked text has the same length). */
interface Statement {
  start: number;
  /** Exclusive end: the index of the closing `;`, or just after the last token when there is none. */
  end: number;
}

type FunctionKind = "function" | "arrow" | "method";

/** The function whose body directly or indirectly contains the statement. */
interface FunctionInfo {
  kind: FunctionKind;
  isAsync: boolean;
  /** Header text (trimmed) and its offset in the source. */
  header: string;
  headerStart: number;
}

/** A replacement of `source.slice(start, end)` by `text`. */
interface TextEdit {
  start: number;
  end: number;
  text: string;
}

interface AsyncPlan {
  edits: TextEdit[];
  warnings: string[];
}

// ---------------------------------------------------------------------------------------------
// Statement location
// ---------------------------------------------------------------------------------------------

function lineStartOffset(source: string, line: number): number {
  let offset = 0;
  for (let current = 1; current < line; current++) {
    const next = source.indexOf("\n", offset);
    if (next === -1) return -1;
    offset = next + 1;
  }
  return offset;
}

function trimEndIndex(masked: string, start: number, index: number): number {
  let end = index;
  while (end > start && /\s/.test(masked.charAt(end - 1))) end--;
  return end;
}

/** After a newline at depth 0, does the expression go on (`.then(`, `?.`)? */
function continuesOnNextLine(masked: string, from: number): boolean {
  return /^\s*\.|^\s*\?\./.test(masked.slice(from));
}

function scanStatementEnd(masked: string, start: number): number {
  let depth = 0;
  for (let i = start; i < masked.length; i++) {
    const ch = masked.charAt(i);
    if (OPENERS.includes(ch)) {
      depth++;
    } else if (CLOSERS.includes(ch)) {
      if (depth === 0) return trimEndIndex(masked, start, i);
      depth--;
    } else if (depth === 0 && ch === ";") {
      return i;
    } else if (depth === 0 && ch === "\n" && !continuesOnNextLine(masked, i + 1)) {
      return trimEndIndex(masked, start, i);
    }
  }
  return trimEndIndex(masked, start, masked.length);
}

/** The statement that begins on `line` (1-based), or undefined when the line is blank / out of range. */
function locateStatement(masked: string, line: number): Statement | undefined {
  const lineStart = lineStartOffset(masked, line);
  if (lineStart === -1) return undefined;
  const lineEnd = masked.indexOf("\n", lineStart);
  const text = masked.slice(lineStart, lineEnd === -1 ? masked.length : lineEnd);
  if (text.trim().length === 0) return undefined;
  const start = lineStart + (text.length - text.trimStart().length);
  return { start, end: scanStatementEnd(masked, start) };
}

// ---------------------------------------------------------------------------------------------
// Statement shape
// ---------------------------------------------------------------------------------------------

const CHAIN = /\.\s*(?:then|catch|finally)\s*\(/y;

function isAssignmentEquals(text: string, index: number): boolean {
  const next = text.charAt(index + 1);
  return next !== "=" && next !== ">" && !"=!<>".includes(text.charAt(index - 1));
}

/** Shape of the statement at nesting depth 0. */
function topLevelShape(text: string): { assignment: boolean; chain: boolean } {
  let depth = 0;
  let assignment = false;
  let chain = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i);
    if (OPENERS.includes(ch)) depth++;
    else if (CLOSERS.includes(ch)) depth--;
    else if (depth === 0 && ch === "=" && isAssignmentEquals(text, i)) assignment = true;
    else if (depth === 0 && ch === ".") {
      CHAIN.lastIndex = i;
      if (CHAIN.test(text)) chain = true;
    }
  }
  return { assignment, chain };
}

/** Why the statement must not be touched, or undefined when it is a plain bare call. */
function rejectReason(text: string): string | undefined {
  if (/^(?:await|return|void)\b/.test(text)) return "the statement already awaits, returns or voids the promise";
  if (!/^[A-Za-z_$]/.test(text)) return "the statement does not start with a plain call";
  const shape = topLevelShape(text);
  if (shape.assignment) return "the promise is part of an assignment";
  if (shape.chain) return "the statement already has a .then/.catch/.finally chain";
  return undefined;
}

// ---------------------------------------------------------------------------------------------
// Enclosing function
// ---------------------------------------------------------------------------------------------

/** Index of the `{` that encloses `position`, or -1. */
function findEnclosingBrace(masked: string, position: number): number {
  let depth = 0;
  for (let i = position - 1; i >= 0; i--) {
    const ch = masked.charAt(i);
    if (ch === "}") depth++;
    else if (ch === "{") {
      if (depth === 0) return i;
      depth--;
    }
  }
  return -1;
}

/** Start of the header that precedes the `{` at `open`: stops at `;`, an unmatched bracket or a top-level `,`. */
function headerStartOf(masked: string, open: number): number {
  let nest = 0;
  let angle = 0;
  for (let i = open - 1; i >= 0; i--) {
    const ch = masked.charAt(i);
    if (CLOSERS.includes(ch)) {
      if (ch === "}" && nest === 0) return i + 1;
      nest++;
    } else if (OPENERS.includes(ch)) {
      if (nest === 0) return i + 1;
      nest--;
    } else if (nest === 0) {
      if (ch === ";" || (ch === "," && angle === 0)) return i + 1;
      if (ch === ">" && masked.charAt(i - 1) !== "=") angle++;
      else if (ch === "<" && angle > 0) angle--;
    }
  }
  return 0;
}

const NON_FUNCTION_BLOCK = /^(?:if|for|while|switch|catch|with|else|try|finally|do|class|interface|namespace|module|enum|declare|abstract\s+class|export\s+(?:default\s+)?(?:abstract\s+)?(?:class|interface|namespace|enum))\b/;
const METHOD = /^((?:(?:public|private|protected|static|override|abstract|get|set)\s+)*)(async\s+)?(\*\s*)?((?:[A-Za-z_$][\w$]*|\[[^\]]*\]))\s*(<[^]*>)?\s*\([^]*\)\s*(?::[^]*)?$/;
const ASYNC_ARROW = /(?:^|[^\w$.])async\s*(?:<[^]*>\s*)?(?:\(|[A-Za-z_$][\w$]*\s*=>)/;

function classifyHeader(masked: string, open: number): FunctionInfo | undefined {
  const start = headerStartOf(masked, open);
  const raw = masked.slice(start, open);
  const header = raw.trim();
  if (header.length === 0) return undefined;
  const headerStart = start + (raw.length - raw.trimStart().length);
  if (NON_FUNCTION_BLOCK.test(header.replace(/^(?:else\s+)+(?=\S)/, ""))) return undefined;
  if (/\bfunction\b/.test(header)) return { kind: "function", isAsync: /\basync\s+function\b/.test(header), header, headerStart };
  if (header.endsWith("=>")) return { kind: "arrow", isAsync: ASYNC_ARROW.test(header), header, headerStart };
  const method = METHOD.exec(header);
  if (method !== null) return { kind: "method", isAsync: method[2] !== undefined, header, headerStart };
  return undefined;
}

/** Nearest enclosing function, skipping if/for/try/... blocks, classes and object literals. */
function findEnclosingFunction(masked: string, position: number): FunctionInfo | undefined {
  let cursor = position;
  for (;;) {
    const open = findEnclosingBrace(masked, cursor);
    if (open === -1) return undefined;
    const info = classifyHeader(masked, open);
    if (info !== undefined) return info;
    cursor = open;
  }
}

// ---------------------------------------------------------------------------------------------
// Making the enclosing function async
// ---------------------------------------------------------------------------------------------

const FUNCTION_PREFIX = /^(?:export\s+(?:default\s+)?)?(?:(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*(?::[^=]+)?=\s*)?(?=function\b)/;
const ARROW_PREFIX = /^(?:export\s+)?(?:(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*(?::[^=]+)?=\s*|(?:(?:public|private|protected|static|readonly)\s+)*[A-Za-z_$][\w$]*\s*(?::[^=]+)?=\s*)(?=(?:<[^]*>\s*)?\(|[A-Za-z_$][\w$]*\s*=>)/;

/** Offset in the header where `async ` goes, or a reason it cannot be edited safely. */
function asyncInsertOffset(fn: FunctionInfo): number | string {
  if (fn.kind === "function") {
    const prefix = FUNCTION_PREFIX.exec(fn.header);
    if (prefix === null) return "the enclosing function is a callback or function expression, not a declaration";
    if (/^function\s*\*/.test(fn.header.slice(prefix[0].length))) return "the enclosing function is a generator";
    return prefix[0].length;
  }
  if (fn.kind === "arrow") {
    const prefix = ARROW_PREFIX.exec(fn.header);
    return prefix === null ? "the enclosing arrow function is a callback or has a header that cannot be edited safely" : prefix[0].length;
  }
  const method = METHOD.exec(fn.header);
  if (method === null) return "the enclosing method header cannot be edited safely";
  if (/\b(?:get|set)\b/.test(method[1] ?? "")) return "the enclosing function is a getter or setter";
  if (method[3] !== undefined) return "the enclosing method is a generator";
  if (method[4] === "constructor") return "the enclosing function is a constructor";
  return (method[1] ?? "").length;
}

/** Index of the bracket closing the one at `open`, or -1. The `>` of `=>` is not a closer. */
function matchingClose(text: string, open: number): number {
  const opener = text.charAt(open);
  const closer = opener === "(" ? ")" : ">";
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const ch = text.charAt(i);
    if (ch === opener) depth++;
    else if (ch === closer && !(closer === ">" && text.charAt(i - 1) === "=") && --depth === 0) return i;
  }
  return -1;
}

/** Offset (in the header) of the `)` closing the parameter list, or -1 when there is none (`x =>`). */
function paramsClose(header: string, from: number): number {
  let open = from;
  while (open < header.length && !"(<".includes(header.charAt(open))) open++;
  if (header.charAt(open) === "<") {
    const generics = matchingClose(header, open);
    if (generics === -1) return -1;
    open = header.indexOf("(", generics);
  }
  return open === -1 || open >= header.length ? -1 : matchingClose(header, open);
}

const TYPED_TAIL = /^(\s*:\s*)([^]*?)(\s*(?:=>)?\s*)$/;

/** `T` becomes `Promise<T>`. Returns a reason when the annotation cannot be wrapped safely. */
function returnTypeEdit(source: string, fn: FunctionInfo, from: number): TextEdit | string | undefined {
  const close = paramsClose(fn.header, from);
  if (close === -1) return undefined;
  const tail = TYPED_TAIL.exec(fn.header.slice(close + 1));
  if (tail === null) return undefined;
  const type = tail[2] ?? "";
  if (type.length === 0 || /^Promise\s*</.test(type)) return undefined;
  if (/=>|\{| is |^asserts /.test(type)) return "the enclosing function has a return type that cannot be wrapped in Promise<> safely";
  const start = fn.headerStart + close + 1 + (tail[1] ?? "").length;
  return { start, end: start + type.length, text: `Promise<${source.slice(start, start + type.length)}>` };
}

function functionName(header: string): string {
  const match = /function\s*\*?\s*([A-Za-z_$][\w$]*)|(?:const|let|var)\s+([A-Za-z_$][\w$]*)|^(?:\w+\s+)*([A-Za-z_$][\w$]*)\s*[(=<]/.exec(header);
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? "the enclosing function";
}

/** Edits that make the enclosing function async (including its return type), or a skip reason. */
function planAsync(source: string, fn: FunctionInfo): AsyncPlan | string {
  const offset = asyncInsertOffset(fn);
  if (typeof offset === "string") return offset;
  const at = fn.headerStart + offset;
  const edits: TextEdit[] = [{ start: at, end: at, text: "async " }];
  const warnings = [`Callers of ${functionName(fn.header)} now receive a Promise and may need awaiting.`];
  const returnType = returnTypeEdit(source, fn, offset);
  if (typeof returnType === "string") return returnType;
  if (returnType !== undefined) {
    edits.push(returnType);
    warnings.push("The return type annotation was wrapped in Promise<>.");
  }
  return { edits, warnings };
}

// ---------------------------------------------------------------------------------------------
// Fix assembly
// ---------------------------------------------------------------------------------------------

function applyTextEdits(source: string, edits: readonly TextEdit[]): string {
  let result = source;
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
    result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
  }
  return result;
}

function callName(text: string): string {
  return `${/^[A-Za-z_$][\w$.]*/.exec(text)?.[0] ?? "call"}()`;
}

function skip(step: PlanStep, reason: string): FixerResult {
  return { kind: "skip", issueId: step.issueId, reason };
}

function makeFix(step: PlanStep, file: string, title: string, content: string, warnings: string[]): FixerResult {
  const fix: ProposedFix = {
    id: `floating-promise|${title}`,
    fixClass: "floating-promise",
    title,
    resolves: [step.issueId],
    edits: [{ file, content }],
    warnings,
    removesSecret: false,
  };
  return { kind: "fix", fix };
}

/** Everything known about one step after reading its file. */
interface StepContext {
  step: PlanStep;
  file: string;
  line: number;
  source: string;
  statement: Statement;
  text: string;
  fn: FunctionInfo | undefined;
}

function makeDecision(sc: StepContext): FixerResult {
  const topLevel = sc.fn === undefined;
  const name = callName(sc.text);
  const options = [
    { key: "async", label: "Make the enclosing function async and await the call (callers then receive a Promise)" },
    { key: "catch", label: "Keep the function synchronous and append .catch() that logs the error" },
  ];
  const decision: FixDecision = {
    issueId: sc.step.issueId,
    question: topLevel
      ? `${name} at ${sc.file}:${sc.line} is at module top level. Top-level await needs an ES module, so how should the rejection be handled?`
      : `${name} at ${sc.file}:${sc.line} is not inside an async function. How should the promise be handled?`,
    options: topLevel ? options.slice(1) : options,
  };
  return { kind: "decision", decision };
}

function proposeAwait(sc: StepContext, extra: AsyncPlan = { edits: [], warnings: [] }): FixerResult {
  const awaitEdit: TextEdit = { start: sc.statement.start, end: sc.statement.start, text: "await " };
  const prefix = extra.edits.length > 0 ? `Make ${functionName(sc.fn?.header ?? "")} async and add await to` : "Add await to";
  const title = `${prefix} ${callName(sc.text)} in ${sc.file}:${sc.line}`;
  return makeFix(sc.step, sc.file, title, applyTextEdits(sc.source, [awaitEdit, ...extra.edits]), extra.warnings);
}

function proposeCatch(sc: StepContext): FixerResult {
  if (sc.source.slice(sc.statement.start, sc.statement.end).includes("\n")) {
    return skip(sc.step, "a multi-line statement cannot be given a .catch() that the audit recognises; add it by hand");
  }
  const edit: TextEdit = { start: sc.statement.end, end: sc.statement.end, text: CATCH_SUFFIX };
  const title = `Add .catch() to ${callName(sc.text)} in ${sc.file}:${sc.line}`;
  return makeFix(sc.step, sc.file, title, applyTextEdits(sc.source, [edit]), []);
}

function proposeAsyncChoice(sc: StepContext): FixerResult {
  if (sc.fn === undefined) return skip(sc.step, "there is no enclosing function to make async (module top level)");
  const plan = planAsync(sc.source, sc.fn);
  if (typeof plan === "string") return skip(sc.step, plan);
  return proposeAwait(sc, plan);
}

function proposeSynchronous(sc: StepContext, choices: ReadonlyMap<string, string>): FixerResult {
  const choice = choices.get(sc.step.issueId);
  if (choice === undefined) return makeDecision(sc);
  if (choice === "async") return proposeAsyncChoice(sc);
  if (choice === "catch") return proposeCatch(sc);
  return skip(sc.step, `unknown choice "${choice}" (valid: async, catch)`);
}

function buildContext(step: PlanStep, projectRoot: string): StepContext | FixerResult {
  if (!SUPPORTED_CODES.has(step.code)) return skip(step, `${step.code} is not handled by the floating-promise fixer`);
  if (step.file === undefined || step.line === undefined) return skip(step, "the issue has no file or line");
  let source: string | undefined;
  try {
    source = readIfExists(projectRoot, step.file);
  } catch {
    return skip(step, `cannot read ${step.file}`);
  }
  if (source === undefined) return skip(step, `${step.file} does not exist`);
  const masked = maskLiteralsAndComments(source);
  const statement = locateStatement(masked, step.line);
  if (statement === undefined) return skip(step, `no statement starts at ${step.file}:${step.line}`);
  const text = masked.slice(statement.start, statement.end);
  const reason = rejectReason(text);
  if (reason !== undefined) return skip(step, reason);
  return { step, file: step.file, line: step.line, source, statement, text, fn: findEnclosingFunction(masked, statement.start) };
}

function isResult(value: StepContext | FixerResult): value is FixerResult {
  return "kind" in value;
}

/**
 * Repairs `ASYNC_FLOATING_PROMISE` and `ASYNC_MISSING_AWAIT` findings.
 *
 * - Statement inside an `async` function: inserts `await ` before the call.
 * - Anywhere else the fixer does not guess: it returns a decision (`async` makes the enclosing
 *   declared function async and awaits; `catch` appends a logging `.catch()`).
 * - Statements that already await/return/void, are assigned or are part of a promise chain are skipped.
 *
 * Every step is computed from the original file on its own; the fix session re-plans after each applied fix.
 */
export class FloatingPromiseFixer implements Fixer {
  readonly fixClass: FixClass = "floating-promise";

  propose(steps: readonly PlanStep[], context: FixContext): FixerResult[] {
    return steps.map((step) => {
      const sc = buildContext(step, context.projectRoot);
      if (isResult(sc)) return sc;
      return sc.fn?.isAsync === true ? proposeAwait(sc) : proposeSynchronous(sc, context.choices);
    });
  }
}
