import type { AgentIssue } from "../../agent/types.js";
import { collectIssues } from "../planner.js";
import { applyEdits, copyProject, removeCopy } from "./project-copy.js";
import type { ProposedFix } from "./types.js";

/** Injectable dependencies of {@link verifyFix}. */
export interface VerifyDeps {
  /** Produces the issue list of a project folder. Defaults to the real audit; tests inject a fake. */
  collect?: ((projectRoot: string) => Promise<AgentIssue[]>) | undefined;
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
 * The baseline is measured on a copy too, so both audits see the same conditions.
 * The real project is never touched. A crash while verifying counts as a rejection.
 */
export async function verifyFix(projectRoot: string, fix: ProposedFix, deps: VerifyDeps = {}): Promise<VerifyOutcome> {
  const collect = deps.collect ?? defaultCollect;
  const copy = copyProject(projectRoot);
  try {
    const before = await collect(copy);
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

    if (stillPresent.length > 0) return { accepted: false, reason: "the issue is still reported after the fix", stillPresent, introduced };
    if (introduced.length > 0) return { accepted: false, reason: "the fix introduces new issues", stillPresent, introduced };
    return { accepted: true, resolved: targetIds.size };
  } catch (error) {
    return { accepted: false, reason: `verification failed: ${error instanceof Error ? error.message : "unknown error"}`, stillPresent: [], introduced: [] };
  } finally {
    removeCopy(copy);
  }
}
