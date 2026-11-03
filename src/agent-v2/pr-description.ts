import { createPlan } from "./planner.js";
import { DEFAULT_FIXERS } from "./fix/registry.js";
import { runFixSession, type FixOutcome, type FixSessionResult } from "./fix/session.js";
import type { Fixer } from "./fix/types.js";
import type { AgentPlan, FixClass, PlanStep } from "./types.js";

/** Output of {@link buildPrDescription}: a one-line title and a markdown body. */
export interface PrDescription {
  title: string;
  body: string;
}

export interface PrDescriptionOptions {
  projectRoot: string;
  /** Answers to fixer decisions, keyed by issue id (same as `fix --choose`). */
  choices?: ReadonlyMap<string, string> | undefined;
  /** Fixers to use; defaults to the registered ones. */
  fixers?: readonly Fixer[] | undefined;
  /** Shell commands that each fix must also pass (same as `fix --verify-cmd`). */
  verifyCommands?: string[] | undefined;
  /** Time limit per verify command in milliseconds. */
  verifyTimeoutMs?: number | undefined;
}

const MAX_LISTED = 10;

function count(steps: readonly PlanStep[], fixClass: FixClass): number {
  return steps.filter((s) => s.fixClass === fixClass).length;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function where(step: PlanStep): string {
  if (step.file === undefined) return "(no file)";
  return step.line === undefined ? step.file : `${step.file}:${step.line}`;
}

function listed(lines: readonly string[]): string[] {
  const shown = lines.slice(0, MAX_LISTED);
  if (lines.length > MAX_LISTED) shown.push(`- ...and ${lines.length - MAX_LISTED} more`);
  return shown;
}

/** One-line PR title built from what was actually fixed (counts of accepted fixes, not of reported issues). */
function buildTitle(outcomes: readonly FixOutcome[]): string {
  const accepted = outcomes.filter((o) => o.status === "verified" || o.status === "applied");
  const byClass = (c: FixClass): number => accepted.filter((o) => o.fix.fixClass === c).length;
  const parts: string[] = [];
  if (byClass("floating-promise") > 0) parts.push(`await ${plural(byClass("floating-promise"), "floating promise", "floating promises")}`);
  if (byClass("hardcoded-secret") > 0) parts.push(`move ${plural(byClass("hardcoded-secret"), "secret", "secrets")} to env`);
  if (byClass("env-documentation") > 0) parts.push("document env variables in .env.example");
  return parts.length === 0 ? "fix: no verified fixes (nothing to merge)" : `fix: ${parts.join(", ")}`;
}

function problemSection(plan: AgentPlan): string[] {
  const steps = plan.steps;
  const lines = ["## المشكلة / Problem", ""];
  if (steps.length === 0) return [...lines, "The audit reports no issues.", ""];
  lines.push(`The audit reports ${plural(steps.length, "issue", "issues")} (${plural(plan.summary.autoFixable, "auto-fixable", "auto-fixable")}):`, "");
  const promises = steps.filter((s) => s.fixClass === "floating-promise").map((s) => `- floating promise (${s.code}) at ${where(s)}`);
  const secrets = steps.filter((s) => s.fixClass === "hardcoded-secret").map((s) => `- hardcoded secret (${s.code}) at ${where(s)} (value not shown)`);
  const envs = steps.filter((s) => s.fixClass === "env-documentation").map((s) => `- ${s.title} (${s.code})${s.file === undefined ? "" : ` at ${where(s)}`}`);
  lines.push(...listed(promises), ...listed(secrets), ...listed(envs));
  const manual = count(steps, "manual");
  if (manual > 0) lines.push(`- ${plural(manual, "other issue", "other issues")} that need a manual fix (not covered by this change)`);
  return [...lines, ""];
}

function solutionSection(result: FixSessionResult): string[] {
  const lines = ["## الحل / Solution", ""];
  const accepted = result.outcomes.filter((o) => o.status === "verified" || o.status === "applied");
  const inPatch = accepted.filter((o) => !o.fix.removesSecret || o.status === "applied");
  const secretOnly = accepted.filter((o) => o.fix.removesSecret && o.status === "verified");
  const rejected = result.outcomes.filter((o) => o.status === "rejected" || o.status === "declined");
  if (accepted.length === 0) lines.push("No fix passed verification, so there is no change to merge.");
  for (const o of inPatch) lines.push(`- ${o.fix.title} (${o.fix.edits.map((e) => e.file).join(", ")})`);
  for (const o of secretOnly) {
    lines.push(`- ${o.fix.title}: verified, but kept out of the patch file because a diff would contain the removed secret; apply it with \`muraqib-agent fix --apply\``);
    for (const w of o.fix.warnings) lines.push(`  - WARNING: ${w}`);
  }
  for (const o of rejected) lines.push(`- Not applied: ${o.fix.title} - ${o.note ?? "rejected"}`);
  for (const d of result.decisions) lines.push(`- Waiting for a decision on ${d.issueId}: ${d.question} Options: ${d.options.map((x) => x.key).join(" or ")}`);
  for (const s of result.skipped) lines.push(`- Skipped ${s.issueId}: ${s.reason}`);
  return [...lines, ""];
}

function testingSection(result: FixSessionResult): string[] {
  const accepted = result.outcomes.filter((o) => o.status === "verified" || o.status === "applied").length;
  const rejected = result.outcomes.filter((o) => o.status === "rejected").length;
  const lines = ["## الاختبار / Testing", ""];
  lines.push(`- Every fix was applied to a temporary copy of the project and the audit was re-run: ${accepted} accepted, ${rejected} rejected. A fix is accepted only when its issue disappears and no new issue appears.`);
  if (result.issuesBefore !== undefined && result.issuesAfter !== undefined) {
    lines.push(`- Issues reported: ${result.issuesBefore} before, ${result.issuesAfter} after the accepted fixes${result.outcomes.some((o) => o.fix.removesSecret && o.status === "verified") ? " (secret fixes are not applied in propose mode, so they still count)" : ""}.`);
  }
  const passed = [...new Set(result.outcomes.flatMap((o) => o.commandCheck?.passed ?? []))];
  const unusable = [...new Set(result.outcomes.flatMap((o) => o.commandCheck?.warnings ?? []))];
  if (passed.length > 0) lines.push(`- Verify commands run on the fixed copy and passed: ${passed.map((c) => `\`${c}\``).join(", ")}.`);
  for (const w of unusable) lines.push(`- ${w}`);
  lines.push("- Not covered by this tool: the project's own tests. Run `npm run type-check && npm run build && npm run lint && npm test` before pushing.");
  return [...lines, ""];
}

/**
 * Pure formatter: turns the plan and the verification result into a PR description.
 * Contains only titles, files, lines, counts and warnings - never a secret value, and no attribution lines.
 */
export function formatPrDescription(plan: AgentPlan, result: FixSessionResult): PrDescription {
  if (!plan.ok || !result.ok) {
    const reason = plan.error ?? result.error ?? "the audit could not run";
    return { title: "fix: audit could not run", body: `## المشكلة / Problem\n\nThe audit failed: ${reason}\n` };
  }
  const body = [...problemSection(plan), ...solutionSection(result), ...testingSection(result)].join("\n");
  return { title: buildTitle(result.outcomes), body: `${body.trimEnd()}\n` };
}

/**
 * Runs the real verification (propose mode on a temp copy; the project is not modified) and
 * writes the PR description from its actual outcome.
 */
export async function buildPrDescription(options: PrDescriptionOptions): Promise<PrDescription> {
  const plan = await createPlan({ projectRoot: options.projectRoot });
  const result = await runFixSession({ projectRoot: options.projectRoot, mode: "propose", choices: options.choices, fixers: options.fixers ?? DEFAULT_FIXERS, verifyCommands: options.verifyCommands, verifyTimeoutMs: options.verifyTimeoutMs });
  return formatPrDescription(plan, result);
}
