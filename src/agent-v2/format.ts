import type { AgentPlan, PlanStep } from "./types.js";

function location(step: PlanStep): string {
  if (step.file === undefined) return "(no file)";
  return step.line === undefined ? step.file : `${step.file}:${step.line}`;
}

/** Plain-text plan (no colour codes), stable across runs so it can be diffed. */
export function formatPlanText(plan: AgentPlan): string {
  if (!plan.ok) return `Muraqib agent plan failed: ${plan.error ?? "audit could not run"}\n`;
  const { summary } = plan;
  const lines = [
    `Muraqib agent plan for ${plan.projectRoot}`,
    `Verdict: ${plan.verdict} | ${summary.total} step(s): ${summary.autoFixable} auto-fixable, ${summary.manual} manual`,
    `Fix classes: floating-promise=${summary.byFixClass["floating-promise"]}, hardcoded-secret=${summary.byFixClass["hardcoded-secret"]}, env-documentation=${summary.byFixClass["env-documentation"]}, manual=${summary.byFixClass.manual}`,
    "",
  ];
  if (plan.steps.length === 0) lines.push("Nothing to fix.");
  for (const step of plan.steps) {
    lines.push(`${step.rank}. [${step.severity}] ${step.code} - ${step.title}`);
    lines.push(`   ${location(step)} | ${step.fixClass}${step.autoFixable ? "" : " (manual)"}`);
    lines.push(`   why: ${step.reasons.join("; ")}`);
  }
  return `${lines.join("\n")}\n`;
}

/** Plan as pretty-printed JSON. */
export function formatPlanJson(plan: AgentPlan): string {
  return `${JSON.stringify(plan, null, 2)}\n`;
}
