import { createPlan } from "./planner.js";
import type { AgentPlan, PlanOptions } from "./types.js";

/** Phases of the agent loop. Day 1 ships `plan` only; later phases extend this union. */
export type AgentPhase = "plan";

/** Result of one agent run. */
export interface AgentRunResult {
  phase: AgentPhase;
  plan: AgentPlan;
}

/**
 * Entry point of the agent loop. The plan phase is fully deterministic and offline: it makes
 * no network call and uses no LLM.
 */
export async function runAgent(phase: AgentPhase, options: PlanOptions = {}): Promise<AgentRunResult> {
  return { phase, plan: await createPlan(options) };
}
