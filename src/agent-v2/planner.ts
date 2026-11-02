import { runAuditForAgent } from "../agent/run-audit-for-agent.js";
import type { AgentIssue, AgentSeverity } from "../agent/types.js";
import { redactText } from "./explain/redact.js";
import { detectUndocumentedEnv, ENV_MODULE } from "./detectors/env.js";
import { detectHardcodedSecrets, SECRETS_MODULE } from "./detectors/secrets.js";
import {
  AGENT_PLAN_SCHEMA_VERSION,
  type AgentPlan,
  type FixClass,
  type PlanOptions,
  type PlanStep,
} from "./types.js";

const SEVERITY_RANK: Record<AgentSeverity, number> = { critical: 0, error: 1, warning: 2, info: 3 };
const FLOATING_PROMISE_CODES: ReadonlySet<string> = new Set(["ASYNC_FLOATING_PROMISE", "ASYNC_MISSING_AWAIT"]);
const FIX_CLASSES: readonly FixClass[] = ["floating-promise", "hardcoded-secret", "env-documentation", "manual"];

/** Maps a v1/agent-v2 issue to the fix class agent-v2 can repair it with. */
export function classifyIssue(issue: AgentIssue): FixClass {
  if (issue.module === "async-guard" && FLOATING_PROMISE_CODES.has(issue.code)) return "floating-promise";
  if (issue.module === SECRETS_MODULE) return "hardcoded-secret";
  if (issue.module === ENV_MODULE) return "env-documentation";
  return "manual";
}

/** Paths in a plan always use `/`, so ranking and fixers behave the same on Windows and Linux. */
function toPosix(file: string): string {
  return file.split("\\").join("/");
}

/** 0 = production source, 1 = other, 2 = tests/examples/docs. Production code is fixed first. */
function locationTier(rawFile: string | undefined): number {
  if (rawFile === undefined) return 1;
  const file = toPosix(rawFile);
  if (/(^|\/)(tests?|__tests__|examples?|docs?|fixtures?)\//.test(file) || /\.(spec|test)\.[jt]sx?$/.test(file)) return 2;
  return file.startsWith("src/") ? 0 : 1;
}

function toStep(issue: AgentIssue, fixClass: FixClass): PlanStep {
  const autoFixable = fixClass !== "manual";
  const tier = locationTier(issue.file);
  const step: PlanStep = {
    rank: 0,
    issueId: issue.id,
    module: issue.module,
    code: issue.code,
    severity: issue.severity,
    title: issue.title,
    detail: redactText(issue.message),
    fixClass,
    autoFixable,
    reasons: [
      `severity ${issue.severity}`,
      autoFixable ? `auto-fixable (${fixClass})` : "needs manual fix",
      tier === 0 ? "in src/" : tier === 2 ? "in tests/examples/docs" : "outside src/",
    ],
  };
  if (issue.file !== undefined) step.file = toPosix(issue.file);
  if (issue.line !== undefined) step.line = issue.line;
  return step;
}

/**
 * Pure, deterministic ranking. Fixed rule order: severity (critical first), then auto-fixable
 * before manual, then location (src/ before other paths before tests/docs), then file, line, id.
 * Duplicate issue ids are collapsed.
 */
export function rankIssues(issues: readonly AgentIssue[], maxSteps?: number): PlanStep[] {
  const unique = new Map<string, AgentIssue>();
  for (const issue of issues) if (!unique.has(issue.id)) unique.set(issue.id, issue);

  const entries = [...unique.values()].map((issue) => ({ issue, step: toStep(issue, classifyIssue(issue)) }));
  entries.sort(
    (a, b) =>
      SEVERITY_RANK[a.issue.severity] - SEVERITY_RANK[b.issue.severity] ||
      Number(b.step.autoFixable) - Number(a.step.autoFixable) ||
      locationTier(a.issue.file) - locationTier(b.issue.file) ||
      toPosix(a.issue.file ?? "").localeCompare(toPosix(b.issue.file ?? "")) ||
      (a.issue.line ?? 0) - (b.issue.line ?? 0) ||
      a.issue.id.localeCompare(b.issue.id)
  );

  const limit = maxSteps !== undefined && maxSteps >= 0 ? maxSteps : entries.length;
  return entries.slice(0, limit).map(({ step }, index) => ({ ...step, rank: index + 1 }));
}

function summarize(steps: readonly PlanStep[]): AgentPlan["summary"] {
  const byFixClass = Object.fromEntries(FIX_CLASSES.map((c) => [c, 0])) as Record<FixClass, number>;
  for (const step of steps) byFixClass[step.fixClass] += 1;
  const autoFixable = steps.filter((s) => s.autoFixable).length;
  return { total: steps.length, autoFixable, manual: steps.length - autoFixable, byFixClass };
}

/** Outcome of running the audit: the issues, or the error that stopped it. */
export type CollectedIssues = { ok: true; issues: AgentIssue[] } | { ok: false; error: string };

/** v1 audit plus the agent-v2 secret and env detectors, unranked. Never throws. */
export async function collectIssues(projectRoot: string, modules?: string[]): Promise<CollectedIssues> {
  const report = await runAuditForAgent({ projectRoot, modules });
  if (!report.ok) return { ok: false, error: report.error ?? "audit failed" };
  return { ok: true, issues: [...report.issues, ...detectHardcodedSecrets(projectRoot), ...detectUndocumentedEnv(projectRoot)] };
}

/**
 * Builds the plan for a project: runs the v1 audit (`runAuditForAgent`), adds the agent-v2
 * secret and env detectors, then ranks everything with fixed rules. No network, no LLM.
 * Never throws: an audit failure comes back as `{ ok: false, error }`.
 */
export async function createPlan(options: PlanOptions = {}): Promise<AgentPlan> {
  const projectRoot = options.projectRoot ?? process.cwd();
  const collected = await collectIssues(projectRoot, options.modules);
  if (!collected.ok) {
    return {
      schemaVersion: AGENT_PLAN_SCHEMA_VERSION,
      projectRoot,
      verdict: "fail",
      ok: false,
      error: collected.error,
      summary: summarize([]),
      steps: [],
    };
  }
  const issues = collected.issues;
  const steps = rankIssues(issues, options.maxSteps);
  const failing = issues.some((i) => i.severity === "critical" || i.severity === "error");
  return {
    schemaVersion: AGENT_PLAN_SCHEMA_VERSION,
    projectRoot,
    verdict: failing ? "fail" : "pass",
    ok: true,
    summary: summarize(steps),
    steps,
  };
}
