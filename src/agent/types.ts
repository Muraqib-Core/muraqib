/**
 * Agent-facing report model: a small, stable, deterministic JSON contract that LLM agents
 * (Claude Code, Cursor, MCP clients, custom pipelines) can parse without scraping terminal text.
 */

export const AGENT_REPORT_SCHEMA_VERSION = "1.0" as const;

export type AgentSeverity = "critical" | "error" | "warning" | "info";

export interface AgentIssue {
  /** Stable fingerprint of module + code + location + message; identical across runs. */
  id: string;
  module: string;
  code: string;
  severity: AgentSeverity;
  title: string;
  message: string;
  file?: string;
  line?: number;
  column?: number;
  recommendation?: string;
  tags: string[];
}

export interface AgentModuleSummary {
  name: string;
  status: "ok" | "issues" | "warning" | "error";
  issueCount: number;
}

export interface AgentReport {
  schemaVersion: typeof AGENT_REPORT_SCHEMA_VERSION;
  /** False only when the audit itself could not run; findings do not make `ok` false. */
  ok: boolean;
  /** "fail" when any critical/error issue exists (or any warning with `failOnWarning`). */
  verdict: "pass" | "fail";
  projectRoot: string;
  summary: Record<AgentSeverity, number> & { total: number };
  modules: AgentModuleSummary[];
  /** Sorted by severity, then module, file, line - deterministic order. */
  issues: AgentIssue[];
  /** Number of issues dropped by `maxIssues`; 0 when nothing was truncated. */
  truncated: number;
  aiAdvisory?: string;
  error?: string;
}

export interface AgentAuditOptions {
  projectRoot?: string;
  /** Module-name filters, e.g. ["security", "memory"]. */
  modules?: string[];
  securityUrl?: string;
  /** Include the scan layer: OSV vulnerabilities, Docker, compatibility, env files. */
  osv?: boolean;
  docker?: boolean;
  aiAdvisory?: boolean;
  failOnWarning?: boolean;
  /** Cap the issue list to keep an agent's context small. */
  maxIssues?: number;
}
