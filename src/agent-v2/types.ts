import type { AgentSeverity } from "../agent/types.js";

/**
 * Types for the agent-v2 planner. The plan is a deterministic, LLM-free ordering of the issues
 * reported by the v1 audit (`runAuditForAgent`).
 */

export const AGENT_PLAN_SCHEMA_VERSION = "1.0" as const;

/**
 * The three fix classes agent-v2 knows how to repair. Anything else is `manual`.
 * - `floating-promise`: a promise is created but never awaited / handled.
 * - `hardcoded-secret`: a secret literal in source that should move to an environment variable.
 * - `env-documentation`: environment variables used but not documented in `.env.example`.
 */
export type FixClass = "floating-promise" | "hardcoded-secret" | "env-documentation" | "manual";

/** One ordered step of the plan. Never carries a secret value - only where the secret lives. */
export interface PlanStep {
  /** 1-based position in the plan. */
  rank: number;
  /** Fingerprint of the underlying v1 issue (`AgentIssue.id`). */
  issueId: string;
  module: string;
  code: string;
  severity: AgentSeverity;
  title: string;
  fixClass: FixClass;
  /** True when agent-v2 has a fixer for this fix class (not "manual"). */
  autoFixable: boolean;
  file?: string;
  line?: number;
  /** Human-readable reasons behind the rank, in the order the rules were applied. */
  reasons: string[];
  /** Redacted, secret-free description of the issue; this is the only issue text ever sent to an LLM. */
  detail?: string;
  /** Set only by `--explain`: LLM or built-in explanation of the step. */
  explanation?: string;
}

/** How the explanations were produced. `fallback` = built-in templates, no LLM output used. */
export interface ExplainerInfo {
  mode: "llm" | "cached" | "fallback";
  model: string;
  /** API requests made this run, retries included. */
  calls: number;
  /** Explanations served from the disk cache. */
  cached: number;
  notice?: string;
}

export interface AgentPlan {
  schemaVersion: typeof AGENT_PLAN_SCHEMA_VERSION;
  projectRoot: string;
  /** Mirrors the v1 verdict of the underlying audit. */
  verdict: "pass" | "fail";
  /** False when the underlying audit could not run. */
  ok: boolean;
  error?: string;
  summary: { total: number; autoFixable: number; manual: number; byFixClass: Record<FixClass, number> };
  steps: PlanStep[];
  /** Present only when explanations were requested. */
  explainer?: ExplainerInfo;
}

export interface PlanOptions {
  projectRoot?: string | undefined;
  /** Module filters passed through to the v1 audit. */
  modules?: string[] | undefined;
  /** Cap on planned steps; the rest are dropped after ranking. */
  maxSteps?: number | undefined;
}
