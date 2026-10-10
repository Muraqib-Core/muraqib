/**
 * Tool definitions in the JSON-Schema shape shared by MCP, Anthropic tool use and OpenAI function
 * calling (`name` / `description` / `inputSchema`), plus a dispatcher for agent runtimes.
 */
import { runAuditForAgent } from "./run-audit-for-agent.js";
import { getSystemContext } from "./system-context.js";
import { AGENT_REPORT_SCHEMA_VERSION, type AgentAuditOptions } from "./types.js";

export interface AgentToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const AUDIT_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    projectRoot: { type: "string", description: "Absolute path of the project to audit. Defaults to the working directory." },
    modules: { type: "array", items: { type: "string" }, description: "Only run modules whose name contains one of these strings (e.g. security, memory, docker)." },
    securityUrl: { type: "string", description: "Running service URL for HTTP security-header checks." },
    osv: { type: "boolean", description: "Include OSV dependency vulnerability scanning." },
    docker: { type: "boolean", description: "Include Docker discovery and Dockerfile analysis." },
    aiAdvisory: { type: "boolean", description: "Attach an AI remediation advisory (needs an API key)." },
    failOnWarning: { type: "boolean", description: "Treat warnings as a failing verdict." },
    maxIssues: { type: "integer", minimum: 0, description: "Cap the returned issue list to keep context small." },
  },
} as const;

export const AGENT_TOOL_DEFINITIONS: readonly AgentToolDefinition[] = [
  {
    name: "muraqib_audit",
    description:
      `Audit a Node.js/TypeScript project for security, performance, dependency and configuration problems. Returns JSON (schemaVersion ${AGENT_REPORT_SCHEMA_VERSION}): { verdict: "pass"|"fail", summary, issues[] } where each issue has severity, file, line, message and a recommendation. Read-only; deterministic ordering; safe to re-run after fixing code.`,
    inputSchema: AUDIT_INPUT_SCHEMA,
  },
  {
    name: "muraqib_context",
    description: "Describe Muraqib's capabilities, modules, severity semantics and output schema so the agent can plan audits.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
  },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseAuditInput(input: unknown): AgentAuditOptions {
  const src = isRecord(input) ? input : {};
  const out: AgentAuditOptions = {};
  if (typeof src.projectRoot === "string") out.projectRoot = src.projectRoot;
  if (Array.isArray(src.modules)) out.modules = src.modules.filter((m): m is string => typeof m === "string");
  if (typeof src.securityUrl === "string") out.securityUrl = src.securityUrl;
  for (const flag of ["osv", "docker", "aiAdvisory", "failOnWarning"] as const) {
    if (typeof src[flag] === "boolean") out[flag] = src[flag];
  }
  if (typeof src.maxIssues === "number" && Number.isInteger(src.maxIssues)) out.maxIssues = src.maxIssues;
  return out;
}

/** Execute a tool call by name. Unknown tools return an error object instead of throwing. */
export async function executeAgentTool(name: string, input: unknown): Promise<unknown> {
  switch (name) {
    case "muraqib_audit":
      return runAuditForAgent(parseAuditInput(input));
    case "muraqib_context":
      return getSystemContext();
    default:
      return { ok: false, error: `Unknown tool: ${name}` };
  }
}
