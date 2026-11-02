import type { AgentIssue } from "../../agent/types.js";
import { createPlan, planFromIssues } from "../planner.js";
import type { AgentPlan, FixClass, PlanStep } from "../types.js";
import { makePatch } from "./patch.js";
import { applyEdits, copyProject, removeCopy } from "./project-copy.js";
import { verifyFixDetailed, type VerifyDeps, type VerifyOutcome } from "./verify.js";
import type { FixDecision, FixMode, Fixer, FixerResult, ProposedFix } from "./types.js";

/** Fix classes in the order they are repaired: secrets before the env file so the file can list the new variable. */
const FIX_ORDER: readonly FixClass[] = ["floating-promise", "hardcoded-secret", "env-documentation"];
/** Safety net against a loop that never converges. */
const MAX_ROUNDS = 100;

/** Fate of one proposed fix: `applied` to disk, `verified` only, `rejected` by verification, or `declined` by the user. */
export type FixStatus = "applied" | "verified" | "rejected" | "declined";

/** Result for a single proposed fix, including why it was rejected or declined. */
export interface FixOutcome {
  fix: ProposedFix;
  status: FixStatus;
  /** Why it was rejected / declined, or a note such as "apply mode only". */
  note?: string;
  verification?: VerifyOutcome;
}

/** Inputs of {@link runFixSession}. */
export interface FixSessionOptions {
  projectRoot: string;
  mode: FixMode;
  choices?: ReadonlyMap<string, string> | undefined;
  fixers: readonly Fixer[];
  /** Apply mode only: asked once per verified fix; return false to skip it. */
  approve?: ((fix: ProposedFix) => Promise<boolean>) | undefined;
  verifyDeps?: VerifyDeps | undefined;
  maxFixes?: number | undefined;
  /**
   * Propose mode with the real audit only: reuse audit results that are provably about the current
   * tree (the round's plan as verification baseline, the after-fix audit as the next round's plan)
   * instead of auditing again. `false` forces the original audit-everything behavior. Default `true`.
   */
  reuseAudits?: boolean | undefined;
}

/** Everything a fix session produced: per-fix outcomes, open decisions, skipped issues and the patch. */
export interface FixSessionResult {
  ok: boolean;
  error?: string;
  mode: FixMode;
  outcomes: FixOutcome[];
  decisions: FixDecision[];
  skipped: { issueId: string; reason: string }[];
  /** Unified diff of every accepted, secret-free fix (propose mode). Empty when there is nothing to patch. */
  patch: string;
  /** Issues in the plan before any fix, and still left after the last accepted fix. `undefined` when the audit failed. */
  issuesBefore?: number;
  issuesAfter?: number;
}

function groupByClass(steps: readonly PlanStep[]): Map<FixClass, PlanStep[]> {
  const groups = new Map<FixClass, PlanStep[]>();
  for (const step of steps) if (step.autoFixable) groups.set(step.fixClass, [...(groups.get(step.fixClass) ?? []), step]);
  return groups;
}

function collectResults(fixers: readonly Fixer[], steps: readonly PlanStep[], root: string, originalRoot: string, choices: ReadonlyMap<string, string>): FixerResult[] {
  const groups = groupByClass(steps);
  const results: FixerResult[] = [];
  for (const fixClass of FIX_ORDER) {
    const group = groups.get(fixClass);
    const fixer = fixers.find((f) => f.fixClass === fixClass);
    if (group !== undefined && fixer !== undefined) results.push(...fixer.propose(group, { projectRoot: root, originalRoot, choices }));
  }
  return results;
}

/**
 * The fix loop. Each round: re-plan the working tree, ask the fixers for proposals, take the
 * first one not yet tried, verify it by re-auditing a copy, and keep it only if accepted.
 *
 * - `propose`: works on a temp copy and returns one patch; the real project is never written.
 *   Fixes that remove a secret are verified but kept out of the patch (the diff would contain the secret).
 * - `apply`: edits the real project after `approve` says yes for each fix. Nothing is committed.
 */
export async function runFixSession(options: FixSessionOptions): Promise<FixSessionResult> {
  const choices = options.choices ?? new Map<string, string>();
  const workRoot = options.mode === "propose" ? copyProject(options.projectRoot) : options.projectRoot;
  const outcomes: FixOutcome[] = [];
  const decisions = new Map<string, FixDecision>();
  const skipped = new Map<string, string>();
  const tried = new Set<string>();
  const touched = new Set<string>();
  let error: string | undefined;
  let issuesBefore: number | undefined;
  let issuesAfter: number | undefined;
  let afterIsStale = false;
  const reuse = canReuseAudits(options);
  /** Issues of the current working tree when they are known without auditing (reuse only). */
  let known: AgentIssue[] | undefined;
  try {
    for (let round = 0; round < MAX_ROUNDS && acceptedCount(outcomes) < (options.maxFixes ?? Infinity); round += 1) {
      const { plan, issues } = await planRound(workRoot, known);
      known = undefined;
      if (!plan.ok) {
        error = plan.error;
        break;
      }
      issuesBefore ??= plan.summary.total;
      issuesAfter = plan.summary.total;
      afterIsStale = false;
      decisions.clear();
      const results = collectResults(options.fixers, plan.steps, workRoot, options.projectRoot, choices);
      recordNotes(results, decisions, skipped);
      const next = results.find((r): r is Extract<FixerResult, { kind: "fix" }> => r.kind === "fix" && !tried.has(r.fix.id));
      if (next === undefined) break;
      tried.add(next.fix.id);
      const handled = await handleFix(next.fix, workRoot, options, touched, reuse ? issues : undefined);
      const outcome = handled.outcome;
      outcomes.push(outcome);
      if (changesWorkTree(outcome)) afterIsStale = true;
      if (reuse) known = changesWorkTree(outcome) ? handled.after : issues;
    }
    if (afterIsStale && error === undefined) {
      issuesAfter = (await planRound(workRoot, known)).plan.summary.total;
    }
    const patch = options.mode === "propose" ? makePatch(options.projectRoot, workRoot, [...touched]) : "";
    const result: FixSessionResult = { ok: error === undefined, mode: options.mode, outcomes, decisions: [...decisions.values()], skipped: [...skipped].map(([issueId, reason]) => ({ issueId, reason })), patch };
    if (error !== undefined) result.error = error;
    if (issuesBefore !== undefined) result.issuesBefore = issuesBefore;
    if (issuesAfter !== undefined) result.issuesAfter = issuesAfter;
    return result;
  } finally {
    if (options.mode === "propose") removeCopy(workRoot);
  }
}

/** Fixes that were accepted by the verification (applied, or verified in propose mode). */
function acceptedCount(outcomes: readonly FixOutcome[]): number {
  return outcomes.filter((o) => o.status === "applied" || o.status === "verified").length;
}

/** True when the fix actually changed the working tree (secret fixes are not applied in propose mode). */
function changesWorkTree(outcome: FixOutcome): boolean {
  return outcome.status === "applied" || (outcome.status === "verified" && !outcome.fix.removesSecret);
}

function recordNotes(results: readonly FixerResult[], decisions: Map<string, FixDecision>, skipped: Map<string, string>): void {
  for (const r of results) {
    if (r.kind === "decision") decisions.set(r.decision.issueId, r.decision);
    else if (r.kind === "skip") skipped.set(r.issueId, r.reason);
  }
}

/** A plan plus the raw issues behind it (`undefined` when the planner did not hand them over). */
interface RoundPlan {
  plan: AgentPlan;
  issues: AgentIssue[] | undefined;
}

/** The plan of the working tree: ranked from `known` issues when the caller can vouch for them, otherwise from a fresh audit. */
async function planRound(workRoot: string, known: AgentIssue[] | undefined): Promise<RoundPlan> {
  if (known !== undefined) return { plan: planFromIssues(workRoot, known), issues: known };
  let captured: AgentIssue[] | undefined;
  const plan = await createPlan({ projectRoot: workRoot }, (issues) => {
    captured = issues;
  });
  return { plan, issues: captured };
}

/**
 * Audit reuse is only sound in propose mode (the working tree is a temp copy, so it is audited under
 * the same conditions as verification's copy and nobody else edits it) and with the real audit.
 * Apply mode audits the real project, which has `.git` that a copy lacks, so it always re-audits.
 */
function canReuseAudits(options: FixSessionOptions): boolean {
  return options.reuseAudits !== false && options.mode === "propose" && options.verifyDeps?.collect === undefined;
}

/** A fix outcome plus, when the fix was applied to the working tree, the issues verification found on the fixed copy. */
interface Handled {
  outcome: FixOutcome;
  after?: AgentIssue[] | undefined;
}

async function handleFix(fix: ProposedFix, workRoot: string, options: FixSessionOptions, touched: Set<string>, baseline: readonly AgentIssue[] | undefined): Promise<Handled> {
  const { outcome: verification, after } = await verifyFixDetailed(workRoot, fix, { ...options.verifyDeps, baseline });
  if (!verification.accepted) return { outcome: { fix, status: "rejected", note: verification.reason, verification } };
  if (options.mode === "propose") {
    if (fix.removesSecret) return { outcome: { fix, status: "verified", note: "removes a secret: kept out of the patch file, use apply mode", verification } };
    applyEdits(workRoot, fix.edits);
    for (const edit of fix.edits) touched.add(edit.file);
    return { outcome: { fix, status: "verified", verification }, after };
  }
  const approved = options.approve === undefined ? false : await options.approve(fix);
  if (!approved) return { outcome: { fix, status: "declined", note: "not approved", verification } };
  applyEdits(workRoot, fix.edits);
  return { outcome: { fix, status: "applied", verification } };
}
