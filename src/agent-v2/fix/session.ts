import { createPlan } from "../planner.js";
import type { FixClass, PlanStep } from "../types.js";
import { makePatch } from "./patch.js";
import { applyEdits, copyProject, removeCopy } from "./project-copy.js";
import { verifyFix, type VerifyDeps, type VerifyOutcome } from "./verify.js";
import type { FixDecision, FixMode, Fixer, FixerResult, ProposedFix } from "./types.js";

/** Fix classes in the order they are repaired: secrets before the env file so the file can list the new variable. */
const FIX_ORDER: readonly FixClass[] = ["floating-promise", "hardcoded-secret", "env-documentation"];
/** Safety net against a loop that never converges. */
const MAX_ROUNDS = 100;

export type FixStatus = "applied" | "verified" | "rejected" | "declined";

export interface FixOutcome {
  fix: ProposedFix;
  status: FixStatus;
  /** Why it was rejected / declined, or a note such as "apply mode only". */
  note?: string;
  verification?: VerifyOutcome;
}

export interface FixSessionOptions {
  projectRoot: string;
  mode: FixMode;
  choices?: ReadonlyMap<string, string> | undefined;
  fixers: readonly Fixer[];
  /** Apply mode only: asked once per verified fix; return false to skip it. */
  approve?: ((fix: ProposedFix) => Promise<boolean>) | undefined;
  verifyDeps?: VerifyDeps | undefined;
  maxFixes?: number | undefined;
}

export interface FixSessionResult {
  ok: boolean;
  error?: string;
  mode: FixMode;
  outcomes: FixOutcome[];
  decisions: FixDecision[];
  skipped: { issueId: string; reason: string }[];
  /** Unified diff of every accepted, secret-free fix (propose mode). Empty when there is nothing to patch. */
  patch: string;
}

function groupByClass(steps: readonly PlanStep[]): Map<FixClass, PlanStep[]> {
  const groups = new Map<FixClass, PlanStep[]>();
  for (const step of steps) if (step.autoFixable) groups.set(step.fixClass, [...(groups.get(step.fixClass) ?? []), step]);
  return groups;
}

function collectResults(fixers: readonly Fixer[], steps: readonly PlanStep[], root: string, choices: ReadonlyMap<string, string>): FixerResult[] {
  const groups = groupByClass(steps);
  const results: FixerResult[] = [];
  for (const fixClass of FIX_ORDER) {
    const group = groups.get(fixClass);
    const fixer = fixers.find((f) => f.fixClass === fixClass);
    if (group !== undefined && fixer !== undefined) results.push(...fixer.propose(group, { projectRoot: root, choices }));
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
  try {
    for (let round = 0; round < MAX_ROUNDS && outcomes.filter((o) => o.status === "applied" || o.status === "verified").length < (options.maxFixes ?? Infinity); round += 1) {
      const plan = await createPlan({ projectRoot: workRoot });
      if (!plan.ok) {
        error = plan.error;
        break;
      }
      decisions.clear();
      const results = collectResults(options.fixers, plan.steps, workRoot, choices);
      for (const r of results) {
        if (r.kind === "decision") decisions.set(r.decision.issueId, r.decision);
        else if (r.kind === "skip") skipped.set(r.issueId, r.reason);
      }
      const next = results.find((r): r is Extract<FixerResult, { kind: "fix" }> => r.kind === "fix" && !tried.has(r.fix.id));
      if (next === undefined) break;
      tried.add(next.fix.id);
      const outcome = await handleFix(next.fix, workRoot, options, touched);
      outcomes.push(outcome);
    }
    const patch = options.mode === "propose" ? makePatch(options.projectRoot, workRoot, [...touched]) : "";
    const result: FixSessionResult = { ok: error === undefined, mode: options.mode, outcomes, decisions: [...decisions.values()], skipped: [...skipped].map(([issueId, reason]) => ({ issueId, reason })), patch };
    if (error !== undefined) result.error = error;
    return result;
  } finally {
    if (options.mode === "propose") removeCopy(workRoot);
  }
}

async function handleFix(fix: ProposedFix, workRoot: string, options: FixSessionOptions, touched: Set<string>): Promise<FixOutcome> {
  const verification = await verifyFix(workRoot, fix, options.verifyDeps);
  if (!verification.accepted) return { fix, status: "rejected", note: verification.reason, verification };
  if (options.mode === "propose") {
    if (fix.removesSecret) return { fix, status: "verified", note: "removes a secret: kept out of the patch file, use apply mode", verification };
    applyEdits(workRoot, fix.edits);
    for (const edit of fix.edits) touched.add(edit.file);
    return { fix, status: "verified", verification };
  }
  const approved = options.approve === undefined ? false : await options.approve(fix);
  if (!approved) return { fix, status: "declined", note: "not approved", verification };
  applyEdits(workRoot, fix.edits);
  return { fix, status: "applied", verification };
}
