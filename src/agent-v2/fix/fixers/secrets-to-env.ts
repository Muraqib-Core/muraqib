import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { findSecrets, type SecretType } from "../../../core/secret-detector.js";
import { commentOnlyLines } from "../../detectors/code-mask.js";
import { collectUsages, readDocumentedKeys } from "../../detectors/env.js";
import type { PlanStep } from "../../types.js";
import { resolveInside } from "../project-copy.js";
import type { FixContext, Fixer, FixerResult, ProposedFix } from "../types.js";
import { buildEnvExample } from "./env-example.js";

const SCAN = { includeHeuristics: false, ignorePlaceholders: true } as const;
const GIT_MAX_BUFFER = 512 * 1024 * 1024;
const MIN_IDENTIFIER_LENGTH = 2;
// A quoted string literal on one line: 'a', "b" or `c` (escapes allowed).
const LITERAL = /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g;
// Identifier directly before the literal: `const a = `, `a: string = `, `a: `.
const IDENT_BEFORE = /([A-Za-z_$][\w$]*)\s*(?::\s*[\w$.<>[\]| ]+?\s*=|[:=])\s*$/;

const WARN_ROTATE = "Rotate this credential: it was written in source code";
const WARN_HISTORY = "This secret exists in git history: rewriting history is not enough, you MUST rotate it";
const WARN_NO_GIT = "Could not check git history; assume the secret is exposed and rotate it";

interface Literal {
  start: number;
  end: number;
  /** Text between the quotes, exactly as written in source. */
  inner: string;
}

/** Finds the quoted literals of one line; template literals with `${}` are not candidates. */
function literalsOf(line: string): Literal[] {
  return [...line.matchAll(LITERAL)]
    .filter((m) => !(m[0].startsWith("`") && m[0].includes("${")))
    .map((m) => ({ start: m.index, end: m.index + m[0].length, inner: m[0].slice(1, -1) }));
}

/** The one literal on the line that is the secret, or undefined when none or several qualify. */
function pickSecretLiteral(line: string): { literal: Literal; type: SecretType } | undefined {
  const matches = findSecrets(line, SCAN);
  const qualifying = literalsOf(line).filter((l) => findSecrets(`${line.slice(0, l.start)}"xxxx"${line.slice(l.end)}`, SCAN).length < matches.length);
  const only = qualifying.length === 1 ? qualifying[0] : undefined;
  const type = matches[0]?.type;
  return only === undefined || type === undefined ? undefined : { literal: only, type };
}

/** `stripeKey` -> `STRIPE_KEY`, `API-key` -> `API_KEY`. */
export function toUpperSnake(identifier: string): string {
  return identifier
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
}

function baseName(before: string, type: SecretType): string {
  const identifier = IDENT_BEFORE.exec(before)?.[1];
  const derived = identifier === undefined ? "" : toUpperSnake(identifier);
  if (derived.length >= MIN_IDENTIFIER_LENGTH && /^[A-Z_]/.test(derived)) return derived;
  return toUpperSnake(type);
}

function uniqueName(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  const next = (n: number): string => (taken.has(`${base}_${n}`) ? next(n + 1) : `${base}_${n}`);
  return next(2);
}

type HistoryState = "found" | "clean" | "unknown";

/** Looks for `value` in the file's git history in memory; the value never reaches a command line. */
function checkHistory(projectRoot: string, file: string, value: string): HistoryState {
  try {
    const log = execFileSync("git", ["log", "--all", "-p", "--", file], {
      cwd: projectRoot,
      encoding: "utf-8",
      maxBuffer: GIT_MAX_BUFFER,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return log.includes(value) ? "found" : "clean";
  } catch {
    return "unknown";
  }
}

function warningsFor(history: HistoryState): string[] {
  const warnings = [WARN_ROTATE];
  if (history === "found") warnings.push(WARN_HISTORY);
  if (history === "unknown") warnings.push(WARN_NO_GIT);
  return [...warnings, "process.env.NAME is string | undefined; adjust types if the code expects string"];
}

/**
 * Fixer for `hardcoded-secret` (severity critical/warning). Replaces the quoted secret literal on
 * the reported line with `process.env.NAME` and documents `NAME=` (empty) in `.env.example`.
 * It never guesses: a line with several candidate literals, a template with `${}` or a multi-line
 * value is skipped. The secret value is only ever held in memory and never appears in a fix.
 */
export class SecretsToEnvFixer implements Fixer {
  readonly fixClass = "hardcoded-secret" as const;

  /**
   * Proposes replacing each hardcoded secret literal with a `process.env` lookup.
   *
   * @param steps - Auto-fixable `hardcoded-secret` plan steps
   * @param context - Project root and git-history source
   * @returns Fixes (flagged `removesSecret`), or skips with a reason
   */
  propose(steps: readonly PlanStep[], context: FixContext): FixerResult[] {
    const taken = new Set<string>([...collectUsages(context.projectRoot).keys(), ...(readDocumentedKeys(context.projectRoot) ?? [])]);
    return steps.map((step): FixerResult => {
      const fix = this.fixFor(step, context.projectRoot, taken, context.originalRoot ?? context.projectRoot);
      return typeof fix === "string" ? { kind: "skip", issueId: step.issueId, reason: fix } : { kind: "fix", fix };
    });
  }

  /** The fix for one step, or the reason it is skipped. */
  private fixFor(step: PlanStep, projectRoot: string, taken: Set<string>, historyRoot: string): ProposedFix | string {
    if (step.file === undefined || step.line === undefined) return "the issue has no file/line";
    const source = this.read(projectRoot, step.file);
    if (source === undefined) return `cannot read ${step.file}`;
    const lines = source.split("\n");
    const line = lines[step.line - 1];
    if (line === undefined) return `line ${step.line} not found in ${step.file}`;
    if (commentOnlyLines(source).has(step.line)) return "the secret is in a comment: delete it by hand and rotate the credential";
    const picked = pickSecretLiteral(line);
    if (picked === undefined) return "no single quoted literal on the line is unambiguously the secret";
    const { literal, type } = picked;
    const name = uniqueName(baseName(line.slice(0, literal.start), type), taken);
    taken.add(name);
    lines[step.line - 1] = `${line.slice(0, literal.start)}process.env.${name}${line.slice(literal.end)}`;
    return {
      id: `hardcoded-secret|Move secret in ${step.file}:${step.line} to process.env.${name}`,
      fixClass: "hardcoded-secret",
      title: `Move secret in ${step.file}:${step.line} to process.env.${name}`,
      resolves: [step.issueId],
      edits: [
        { file: step.file, content: lines.join("\n") },
        { file: ".env.example", content: buildEnvExample(projectRoot, [name]) },
      ],
      warnings: warningsFor(checkHistory(historyRoot, step.file, literal.inner)),
      removesSecret: true,
    };
  }

  private read(projectRoot: string, file: string): string | undefined {
    try {
      return readFileSync(resolveInside(projectRoot, file), "utf-8");
    } catch {
      return undefined;
    }
  }
}
