import type { ScanAuditMetadata } from "../core/types.js";

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
  scan?: ScanAuditMetadata;
}

export interface AgentReport {
  schemaVersion: typeof AGENT_REPORT_SCHEMA_VERSION;
  /** False only when the audit itself could not run; findings do not make `ok` false. */
  ok: boolean;
  /** "fail" when any critical/error issue exists (or any warning with `failOnWarning`). */
  verdict: "pass" | "fail";
  exitCode?: 0 | 1 | 3;
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
  projectRoot?: string | undefined;
  /** Module-name filters, e.g. ["security", "memory"]. */
  modules?: string[] | undefined;
  securityUrl?: string | undefined;
  /** Include the scan layer: OSV vulnerabilities, Docker, compatibility, env files. */
  osv?: boolean | undefined;
  docker?: boolean | undefined;
  aiAdvisory?: boolean | undefined;
  failOnWarning?: boolean | undefined;
  /** Cap the issue list to keep an agent's context small. */
  maxIssues?: number | undefined;
}
