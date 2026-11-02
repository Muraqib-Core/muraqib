import type { AgentIssue } from "../../agent/types.js";
import { collectIssues } from "../planner.js";
import { applyEdits, copyProject, removeCopy } from "./project-copy.js";
import type { ProposedFix } from "./types.js";

/** Injectable dependencies of {@link verifyFix}. */
export interface VerifyDeps {
  /** Produces the issue list of a project folder. Defaults to the real audit; tests inject a fake. */
  collect?: ((projectRoot: string) => Promise<AgentIssue[]>) | undefined;
  /**
   * Issues already known for the exact tree being verified; skips the baseline audit. Callers must
   * only pass a list measured on that same tree, unchanged since, and under copy conditions (no `.git`).
   */
  baseline?: readonly AgentIssue[] | undefined;
}

/** Verdict of re-auditing a fixed copy: accepted (with the count resolved) or rejected with the offending issue keys. */
export type VerifyOutcome =
  | { accepted: true; resolved: number }
  | { accepted: false; reason: string; stillPresent: string[]; introduced: string[] };

/**
 * Identity of an issue that survives unrelated edits: line numbers move when code is inserted,
 * so they are stripped from the message and ignored.
 */
export function stableKey(issue: AgentIssue): string {
  const message = issue.message.replace(/:\d+(?::\d+)?\b/g, "").replace(/\bline \d+\b/gi, "line");
  return [issue.module, issue.code, issue.file ?? "", message].join("|");
}

function countKeys(issues: readonly AgentIssue[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const issue of issues) counts.set(stableKey(issue), (counts.get(stableKey(issue)) ?? 0) + 1);
  return counts;
}

/**
 * Stale-baseline guard: a baseline that does not contain every issue the fix claims to resolve was
 * not measured on this tree, so it is dropped and the caller re-audits as before.
 */
function usableBaseline(baseline: readonly AgentIssue[] | undefined, fix: ProposedFix): readonly AgentIssue[] | undefined {
  if (baseline === undefined) return undefined;
  const ids = new Set(baseline.map((issue) => issue.id));
  return fix.resolves.every((id) => ids.has(id)) ? baseline : undefined;
}

async function defaultCollect(projectRoot: string): Promise<AgentIssue[]> {
  const collected = await collectIssues(projectRoot);
  if (!collected.ok) throw new Error(collected.error);
  return collected.issues;
}

/**
 * Decides whether a fix is real. The project is copied to a temp folder, the edits are applied
 * there, the audit is re-run, and the fix is accepted only when
 *  1. every issue it claims to resolve is gone, and
 *  2. no issue appears that was not there before (a count per issue never goes up).
 * The baseline is measured on a copy too (unless `deps.baseline` is given), so both audits see the same conditions.
 * The real project is never touched. A crash while verifying counts as a rejection.
 */
export async function verifyFix(projectRoot: string, fix: ProposedFix, deps: VerifyDeps = {}): Promise<VerifyOutcome> {
  return (await verifyFixDetailed(projectRoot, fix, deps)).outcome;
}

/** Verdict of {@link verifyFixDetailed} plus the issues found on the fixed copy (absent when verification crashed). */
export interface DetailedVerification {
  outcome: VerifyOutcome;
  after?: AgentIssue[];
}

/**
 * Same decision as {@link verifyFix}, but also returns the after-fix issue list so a caller that
 * then applies the very same edits can reuse it instead of auditing again.
 *
 * `deps.baseline` replaces the baseline audit. It must be the issue list of exactly the tree at
 * `projectRoot`, measured under the same conditions as a copy (no `.git`); the caller guarantees that.
 */
export async function verifyFixDetailed(projectRoot: string, fix: ProposedFix, deps: VerifyDeps = {}): Promise<DetailedVerification> {
  const collect = deps.collect ?? defaultCollect;
  const copy = copyProject(projectRoot);
  try {
    const before = usableBaseline(deps.baseline, fix) ?? (await collect(copy));
    applyEdits(copy, fix.edits);
    const after = await collect(copy);

    const beforeCounts = countKeys(before);
    const afterCounts = countKeys(after);
    const targets = new Map<string, number>();
    const targetIds = new Set(fix.resolves);
    for (const issue of before) if (targetIds.has(issue.id)) targets.set(stableKey(issue), (targets.get(stableKey(issue)) ?? 0) + 1);

    const stillPresent: string[] = [];
    for (const [key, count] of targets) if ((afterCounts.get(key) ?? 0) > (beforeCounts.get(key) ?? 0) - count) stillPresent.push(key);

    const introduced: string[] = [];
    for (const [key, count] of afterCounts) {
      if (!targets.has(key) && count > (beforeCounts.get(key) ?? 0)) introduced.push(key);
    }

    if (stillPresent.length > 0) return { outcome: { accepted: false, reason: "the issue is still reported after the fix", stillPresent, introduced }, after };
    if (introduced.length > 0) return { outcome: { accepted: false, reason: "the fix introduces new issues", stillPresent, introduced }, after };
    return { outcome: { accepted: true, resolved: targetIds.size }, after };
  } catch (error) {
    return { outcome: { accepted: false, reason: `verification failed: ${error instanceof Error ? error.message : "unknown error"}`, stillPresent: [], introduced: [] } };
  } finally {
    removeCopy(copy);
  }
}
