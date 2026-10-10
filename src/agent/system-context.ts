import { AGENT_REPORT_SCHEMA_VERSION, type AgentSeverity } from "./types.js";

export interface SystemContext {
  name: "muraqib";
  schemaVersion: typeof AGENT_REPORT_SCHEMA_VERSION;
  description: string;
  modules: Array<{ name: string; checks: string }>;
  severities: Record<AgentSeverity, string>;
  verdictRule: string;
  commands: Array<{ command: string; purpose: string }>;
  guidance: string[];
}

/**
 * Static, deterministic description of Muraqib for an LLM's system prompt or tool-discovery step.
 * Does no I/O, so it is free to call at agent start-up.
 */
export function getSystemContext(): SystemContext {
  return {
    name: "muraqib",
    schemaVersion: AGENT_REPORT_SCHEMA_VERSION,
    description:
      "Read-only audit engine for Node.js/TypeScript projects. It reports security, performance, dependency, Docker and configuration problems as structured JSON; it never edits code.",
    modules: [
      { name: "security", checks: "HTTP security headers, secrets and injection patterns" },
      { name: "memory", checks: "Heap growth and leak patterns" },
      { name: "async", checks: "Floating promises and async anti-patterns" },
      { name: "dependency", checks: "Circular dependencies and deprecated APIs" },
      { name: "config", checks: "Environment/config validation" },
      { name: "docker", checks: "Dockerfile best practices and image analysis" },
      { name: "compatibility", checks: "Node.js version and peer-dependency compatibility" },
      { name: "scan", checks: "OSV vulnerabilities, env files, Docker discovery (enabled with osv/docker)" },
    ],
    severities: {
      critical: "Exploitable or data-exposing; fix before anything else",
      error: "Definite defect; fix before merging",
      warning: "Likely problem or best-practice violation",
      info: "Advisory only",
    },
    verdictRule: 'verdict is "fail" when any critical or error issue exists (or any warning with failOnWarning).',
    commands: [
      { command: "muraqib agent [--project <dir>] [--osv] [--docker] [--max-issues <n>]", purpose: "Run an audit and print an AgentReport as JSON" },
      { command: "muraqib context", purpose: "Print this system context as JSON" },
      { command: "muraqib tool-schema", purpose: "Print tool definitions (MCP / tool-use compatible)" },
      { command: "muraqib audit --json", purpose: "Print the classic audit report as JSON" },
    ],
    guidance: [
      "Fix issues in severity order and re-run the audit; ids are stable so you can confirm an issue is gone.",
      "Use file and line to locate the problem; recommendation, when present, is the suggested fix.",
      "A non-zero `truncated` means more issues exist than were returned; raise maxIssues or filter by module.",
      "ok:false means the audit could not run (see error); it does not mean the project is clean.",
    ],
  };
}
