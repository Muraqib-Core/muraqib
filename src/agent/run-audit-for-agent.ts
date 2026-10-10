import { createHash } from "node:crypto";
import { collectAuditResults } from "../orchestrator/collect-results.js";
import type { AuditIssue, AuditResult } from "../core/types.js";
import {
  AGENT_REPORT_SCHEMA_VERSION,
  type AgentAuditOptions,
  type AgentIssue,
  type AgentReport,
  type AgentSeverity,
} from "./types.js";

const SEVERITY_ORDER: Record<AgentSeverity, number> = { critical: 0, error: 1, warning: 2, info: 3 };

function fingerprint(module: string, issue: AuditIssue): string {
  const { file, line } = issue.location ?? {};
  return createHash("sha1")
    .update([module, issue.code, file ?? "", line ?? "", issue.message].join("\u0000"))
    .digest("hex")
    .slice(0, 12);
}

function toAgentIssue(module: string, issue: AuditIssue): AgentIssue {
  const out: AgentIssue = {
    id: fingerprint(module, issue),
    module,
    code: issue.code,
    severity: issue.severity,
    title: issue.title,
    message: issue.message,
    tags: [...(issue.tags ?? [])].sort(),
  };
  const { file, line, column } = issue.location ?? {};
  if (file !== undefined) out.file = file;
  if (line !== undefined) out.line = line;
  if (column !== undefined) out.column = column;
  if (issue.recommendation !== undefined) out.recommendation = issue.recommendation;
  return out;
}

function compareIssues(a: AgentIssue, b: AgentIssue): number {
  return (
    SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
    a.module.localeCompare(b.module) ||
    (a.file ?? "").localeCompare(b.file ?? "") ||
    (a.line ?? 0) - (b.line ?? 0) ||
    a.id.localeCompare(b.id)
  );
}

/** Pure mapping from guard/scan results to the agent report; exported for tests and custom pipelines. */
export function buildAgentReport(
  projectRoot: string,
  results: AuditResult[],
  options: Pick<AgentAuditOptions, "failOnWarning" | "maxIssues"> = {},
  aiAdvisory: string | null = null
): AgentReport {
  const all = results.flatMap((r) => r.issues.map((i) => toAgentIssue(r.module, i))).sort(compareIssues);
  const summary = { total: all.length, critical: 0, error: 0, warning: 0, info: 0 };
  for (const issue of all) summary[issue.severity] += 1;

  const limit = options.maxIssues !== undefined && options.maxIssues >= 0 ? options.maxIssues : all.length;
  const failing = summary.critical + summary.error > 0 || (options.failOnWarning === true && summary.warning > 0);

  const report: AgentReport = {
    schemaVersion: AGENT_REPORT_SCHEMA_VERSION,
    ok: true,
    verdict: failing ? "fail" : "pass",
    projectRoot,
    summary,
    modules: results
      .map((r) => ({ name: r.module, status: r.status, issueCount: r.issues.length }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    issues: all.slice(0, limit),
    truncated: Math.max(0, all.length - limit),
  };
  if (aiAdvisory) report.aiAdvisory = aiAdvisory;
  return report;
}

/**
 * Run Muraqib as a tool for an AI agent. Never throws and never prints: failures come back as
 * `{ ok: false, error }` so a tool-calling loop always receives parseable JSON.
 *
 * @example
 * ```typescript
 * const report = await runAuditForAgent({ projectRoot: process.cwd(), osv: true, maxIssues: 50 });
 * if (report.verdict === "fail") fixIssues(report.issues);
 * ```
 */
export async function runAuditForAgent(options: AgentAuditOptions = {}): Promise<AgentReport> {
  const projectRoot = options.projectRoot ?? process.cwd();
  try {
    const { results, aiAdvisory } = await collectAuditResults({
      projectRoot,
      modules: options.modules,
      securityUrl: options.securityUrl,
      scan: Boolean(options.osv || options.docker || options.aiAdvisory),
      aiAdvisory: options.aiAdvisory,
    });
    return buildAgentReport(projectRoot, results, options, aiAdvisory);
  } catch (error) {
    return {
      schemaVersion: AGENT_REPORT_SCHEMA_VERSION,
      ok: false,
      verdict: "fail",
      projectRoot,
      summary: { total: 0, critical: 0, error: 0, warning: 0, info: 0 },
      modules: [],
      issues: [],
      truncated: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
