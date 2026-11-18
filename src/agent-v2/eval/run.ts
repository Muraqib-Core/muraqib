import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ExplainCache } from "../explain/cache.js";
import { explainPlan } from "../explain/explainer.js";
import { DEFAULT_FIXERS } from "../fix/registry.js";
import { runFixSession, type FixSessionResult } from "../fix/session.js";
import type { Fixer } from "../fix/types.js";
import { createPlan } from "../planner.js";
import { buildEvalProjects, type EvalProject, type ExpectedOutcome, type FileTree, type PlantedProblem, type ProblemKind } from "./projects.js";

/** Environment variables that would switch the explainer to a real Gemini call. They are removed during a run. */
const KEY_ENV_VARS: readonly string[] = ["GEMINI_API_KEY", "GOOGLE_API_KEY"];
const EVAL_SCHEMA_VERSION = "1.0" as const;
/** Ceiling of the explainer (its own maximum), so every planned step of these small projects is explained. */
const MAX_EXPLAINED_STEPS = 25;

/** What the harness observed for one planted problem. */
export type ObservedOutcome =
  /** Expected fix: an accepted fix touched the file AND the ground truth holds. */
  | "fixed"
  /** An accepted fix touched the file but the ground truth fails, or code that should stay as is was edited. */
  | "wrongly-fixed"
  /** Expected decision/skip: the code is unchanged (and, for a decision, the fixer asked). */
  | "asked"
  /** Expected decision: the code is unchanged but no decision was reported for it. */
  | "not-asked"
  /** Expected fix: a fix was proposed but verification rejected it. */
  | "rejected"
  /** Expected fix: no fix was accepted or rejected for it. */
  | "missed";

/** A number written as a fraction: the raw counts are always kept next to the value, which is never rounded. */
export interface Fraction {
  numerator: number;
  denominator: number;
  /** `numerator / denominator` unrounded; `null` when the denominator is 0. */
  value: number | null;
}

/** Raw counts. `planted = expectedFix + expectedDecision + expectedSkip`. */
export interface EvalMetrics {
  planted: number;
  expectedFix: number;
  expectedDecision: number;
  expectedSkip: number;
  /** Outcome verified/applied AND ground truth passes. */
  fixedCorrectly: number;
  /** Accepted fix with a failing ground truth, or an edit where a decision/skip was expected. Must be 0. */
  wronglyFixed: number;
  /** Decision/skip expected and the code was left untouched (a decision was also reported when one was expected). */
  correctlyAsked: number;
  /** Expected a decision, code untouched, but no decision was reported for it. */
  notAsked: number;
  /** Expected fix but none was proposed. */
  missed: number;
  /** Expected fix, proposed, but rejected by the re-audit. */
  rejectedByVerification: number;
}

export interface EvalRates {
  fixedCorrectly: Fraction;
  correctlyAsked: Fraction;
  wronglyFixed: Fraction;
}

export interface ProblemResult {
  id: string;
  kind: ProblemKind;
  expected: ExpectedOutcome;
  file: string;
  observed: ObservedOutcome;
  detail: string;
}

export interface FixRecord {
  title: string;
  status: string;
  note: string | null;
}

export interface ProjectEvaluation {
  id: string;
  description: string;
  metrics: EvalMetrics;
  rates: EvalRates;
  /** Issues in the plan before / after the session, `null` when the audit failed. */
  issuesBefore: number | null;
  issuesAfter: number | null;
  durationMs: number;
  sessionError: string | null;
  decisionsReported: number;
  skipsReported: number;
  /** Files that changed although no planted problem lives in them (`.env.example` excluded). */
  collateralFiles: string[];
  fixes: FixRecord[];
  problems: ProblemResult[];
}

export interface TotalEvaluation {
  metrics: EvalMetrics;
  rates: EvalRates;
  issuesBefore: number | null;
  issuesAfter: number | null;
  durationMs: number;
}

export interface ExplainerCounts {
  projectId: string;
  steps: number;
  explainedSteps: number;
  mode: string;
  calls: number;
}

export interface EvaluationResult {
  schemaVersion: typeof EVAL_SCHEMA_VERSION;
  projects: ProjectEvaluation[];
  total: TotalEvaluation;
  /** Built-in (template) explanations only: counts, never text. */
  explainers: { network: false; projects: ExplainerCounts[]; totalSteps: number; totalExplainedSteps: number };
  /** The real Gemini run is never part of this harness. */
  gemini: { measured: false; reason: string };
}

/** Called once per project after the session, before the temp folder is removed. */
export interface InspectInfo {
  projectId: string;
  root: string;
  files: FileTree;
}

export interface EvaluationOptions {
  /** Fixers under test; defaults to {@link DEFAULT_FIXERS}. */
  fixers?: readonly Fixer[] | undefined;
  /** Projects to run; defaults to the three built-in ones. */
  projects?: readonly EvalProject[] | undefined;
  /** Lets a caller look at the final tree of each project before cleanup. */
  inspect?: ((info: InspectInfo) => void) | undefined;
}

// ---------------------------------------------------------------------------------------------
// Temp project I/O
// ---------------------------------------------------------------------------------------------

function writeProject(files: FileTree): string {
  const root = mkdtempSync(join(tmpdir(), "muraqib-eval-"));
  files.forEach((content, file) => {
    const target = join(root, file);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content, "utf-8");
  });
  return root;
}

function walk(root: string, dir: string, out: Map<string, string>): void {
  readdirSync(dir)
    .sort()
    .forEach((name) => {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(root, full, out);
      else out.set(full.slice(root.length + 1).split("\\").join("/"), readFileSync(full, "utf-8"));
    });
}

function readTree(root: string): FileTree {
  const out = new Map<string, string>();
  walk(root, root, out);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------------------------

interface ClassifyContext {
  finalTree: FileTree;
  original: FileTree;
  accepted: ReadonlySet<string>;
  rejected: ReadonlySet<string>;
  /** Decision questions not yet matched to a problem. */
  questions: string[];
}

function touchedFiles(session: FixSessionResult, statuses: readonly string[]): Set<string> {
  return new Set(session.outcomes.filter((o) => statuses.includes(o.status)).flatMap((o) => o.fix.edits.map((e) => e.file)));
}

function result(p: PlantedProblem, observed: ObservedOutcome, detail: string): ProblemResult {
  return { id: p.id, kind: p.kind, expected: p.expected, file: p.file, observed, detail };
}

function classifyFix(p: PlantedProblem, ctx: ClassifyContext): ProblemResult {
  const truth = p.check(ctx.finalTree, ctx.original);
  const accepted = ctx.accepted.has(p.file);
  if (truth && accepted) return result(p, "fixed", "accepted fix, ground truth holds");
  if (truth) return result(p, "missed", "ground truth holds without any accepted fix touching the file (the check is vacuous)");
  if (accepted) return result(p, "wrongly-fixed", "a fix was accepted but the ground truth fails");
  if (ctx.rejected.has(p.file)) return result(p, "rejected", "a fix was proposed but verification rejected it");
  return result(p, "missed", "no fix was proposed");
}

function classifyAsk(p: PlantedProblem, ctx: ClassifyContext): ProblemResult {
  if (!p.check(ctx.finalTree, ctx.original)) return result(p, "wrongly-fixed", `expected ${p.expected} but the original statement was changed`);
  if (p.expected === "skip") return result(p, "asked", "left untouched");
  const index = ctx.questions.findIndex((q) => q.includes(`at ${p.file}:`));
  if (index === -1) return result(p, "not-asked", "left untouched, but no decision was reported for it");
  ctx.questions.splice(index, 1);
  return result(p, "asked", "left untouched and a decision was reported");
}

function classify(p: PlantedProblem, ctx: ClassifyContext): ProblemResult {
  return p.expected === "fix" ? classifyFix(p, ctx) : classifyAsk(p, ctx);
}

// ---------------------------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------------------------

function fraction(numerator: number, denominator: number): Fraction {
  return { numerator, denominator, value: denominator === 0 ? null : numerator / denominator };
}

function count(results: readonly ProblemResult[], observed: ObservedOutcome): number {
  return results.filter((r) => r.observed === observed).length;
}

function metricsOf(results: readonly ProblemResult[]): EvalMetrics {
  const expected = (e: ExpectedOutcome): number => results.filter((r) => r.expected === e).length;
  return {
    planted: results.length,
    expectedFix: expected("fix"),
    expectedDecision: expected("decision"),
    expectedSkip: expected("skip"),
    fixedCorrectly: count(results, "fixed"),
    wronglyFixed: count(results, "wrongly-fixed"),
    correctlyAsked: count(results, "asked"),
    notAsked: count(results, "not-asked"),
    missed: count(results, "missed"),
    rejectedByVerification: count(results, "rejected"),
  };
}

function ratesOf(m: EvalMetrics): EvalRates {
  return {
    fixedCorrectly: fraction(m.fixedCorrectly, m.expectedFix),
    correctlyAsked: fraction(m.correctlyAsked, m.expectedDecision + m.expectedSkip),
    wronglyFixed: fraction(m.wronglyFixed, m.planted),
  };
}

function sumMetrics(all: readonly EvalMetrics[]): EvalMetrics {
  const sum = (pick: (m: EvalMetrics) => number): number => all.reduce((acc, m) => acc + pick(m), 0);
  return {
    planted: sum((m) => m.planted),
    expectedFix: sum((m) => m.expectedFix),
    expectedDecision: sum((m) => m.expectedDecision),
    expectedSkip: sum((m) => m.expectedSkip),
    fixedCorrectly: sum((m) => m.fixedCorrectly),
    wronglyFixed: sum((m) => m.wronglyFixed),
    correctlyAsked: sum((m) => m.correctlyAsked),
    notAsked: sum((m) => m.notAsked),
    missed: sum((m) => m.missed),
    rejectedByVerification: sum((m) => m.rejectedByVerification),
  };
}

/** Sum, or `null` when any part is unknown (a failed audit must not read as 0 issues). */
function sumOrNull(values: readonly (number | null)[]): number | null {
  return values.some((v) => v === null) ? null : values.reduce<number>((acc, v) => acc + (v ?? 0), 0);
}

// ---------------------------------------------------------------------------------------------
// One project
// ---------------------------------------------------------------------------------------------

function collateral(project: EvalProject, finalTree: FileTree): string[] {
  const planted = new Set(project.problems.map((p) => p.file));
  return [...finalTree.entries()]
    .filter(([file, content]) => project.files.get(file) !== content && !planted.has(file) && file !== ".env.example")
    .map(([file]) => file)
    .sort();
}

function toProjectEvaluation(project: EvalProject, session: FixSessionResult, finalTree: FileTree, durationMs: number): ProjectEvaluation {
  const ctx: ClassifyContext = {
    finalTree,
    original: project.files,
    accepted: touchedFiles(session, ["applied", "verified"]),
    rejected: touchedFiles(session, ["rejected"]),
    questions: session.decisions.map((d) => d.question),
  };
  const problems = project.problems.map((p) => classify(p, ctx));
  const metrics = metricsOf(problems);
  return {
    id: project.id,
    description: project.description,
    metrics,
    rates: ratesOf(metrics),
    issuesBefore: session.issuesBefore ?? null,
    issuesAfter: session.issuesAfter ?? null,
    durationMs,
    sessionError: session.error ?? null,
    decisionsReported: session.decisions.length,
    skipsReported: session.skipped.length,
    collateralFiles: collateral(project, finalTree),
    fixes: session.outcomes.map((o) => ({ title: o.fix.title, status: o.status, note: o.note ?? null })),
    problems,
  };
}

async function evaluateProject(project: EvalProject, fixers: readonly Fixer[], inspect: EvaluationOptions["inspect"]): Promise<ProjectEvaluation> {
  const root = writeProject(project.files);
  try {
    const started = Date.now();
    const session = await runFixSession({ projectRoot: root, mode: "apply", fixers, approve: async () => true });
    const durationMs = Date.now() - started;
    const finalTree = readTree(root);
    inspect?.({ projectId: project.id, root, files: finalTree });
    return toProjectEvaluation(project, session, finalTree, durationMs);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------------------------
// Explainers (built-in explanations only)
// ---------------------------------------------------------------------------------------------

async function explainCounts(project: EvalProject): Promise<ExplainerCounts> {
  const root = writeProject(project.files);
  const cacheDir = mkdtempSync(join(tmpdir(), "muraqib-eval-cache-"));
  try {
    const plan = await createPlan({ projectRoot: root });
    const explained = await explainPlan(plan, { top: MAX_EXPLAINED_STEPS }, { cache: new ExplainCache(cacheDir), apiKey: undefined });
    return {
      projectId: project.id,
      steps: explained.steps.length,
      explainedSteps: explained.steps.filter((s) => typeof s.explanation === "string" && s.explanation !== "").length,
      mode: explained.explainer?.mode ?? "none",
      calls: explained.explainer?.calls ?? 0,
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(cacheDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------------------------

/** Maps `items` one at a time (the projects share the process environment and temp folder). */
async function sequentially<T, R>(items: readonly T[], run: (item: T) => Promise<R>): Promise<R[]> {
  return items.reduce<Promise<R[]>>(async (acc, item) => [...(await acc), await run(item)], Promise.resolve([]));
}

/** Removes the Gemini key variables, returning a function that puts them back. */
function withoutKeys(): () => void {
  const saved = KEY_ENV_VARS.map((name) => [name, process.env[name]] as const);
  KEY_ENV_VARS.forEach((name) => delete process.env[name]);
  return () =>
    saved.forEach(([name, value]) => {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    });
}

/**
 * Runs the fixers against the planted projects and compares the final trees with the ground truth.
 * Deterministic and offline: apply mode with an always-yes approval on temp folders (no git), the
 * explainer runs without a key, and `GEMINI_API_KEY` / `GOOGLE_API_KEY` are removed for the whole run.
 *
 * @param options - Optional fixers / projects overrides and an inspection hook
 * @returns Per-project and total metrics with raw counts, explainer counts and the Gemini status
 */
export async function runEvaluation(options: EvaluationOptions = {}): Promise<EvaluationResult> {
  const restore = withoutKeys();
  try {
    const projects = options.projects ?? buildEvalProjects();
    const fixers = options.fixers ?? DEFAULT_FIXERS;
    const evaluated = await sequentially(projects, (project) => evaluateProject(project, fixers, options.inspect));
    const explainers = await sequentially(projects, explainCounts);
    const metrics = sumMetrics(evaluated.map((p) => p.metrics));
    return {
      schemaVersion: EVAL_SCHEMA_VERSION,
      projects: evaluated,
      total: {
        metrics,
        rates: ratesOf(metrics),
        issuesBefore: sumOrNull(evaluated.map((p) => p.issuesBefore)),
        issuesAfter: sumOrNull(evaluated.map((p) => p.issuesAfter)),
        durationMs: evaluated.reduce((acc, p) => acc + p.durationMs, 0),
      },
      explainers: {
        network: false,
        projects: explainers,
        totalSteps: explainers.reduce((acc, e) => acc + e.steps, 0),
        totalExplainedSteps: explainers.reduce((acc, e) => acc + e.explainedSteps, 0),
      },
      gemini: { measured: false, reason: "No API key is available to this harness and it never uses the network; the real Gemini explanations were not measured." },
    };
  } finally {
    restore();
  }
}
