---
title: AI agents
type: reference
created: 2026-11-04
updated: 2026-11-04
sources:
  - code: src/agent/index.ts
verified_at: f39b88d
---

# 🤖 AI agents (Claude Code, Cursor, MCP clients)

> Part of the [Muraqib documentation](../README.md). See also [agent-v2.md](agent-v2.md) and [cli.md](cli.md).

Muraqib is usable as a tool by LLM agents. The agent output is a versioned (`schemaVersion: "1.0"`), deterministic JSON report: no timestamps or durations, issues sorted by severity, and stable issue `id`s so an agent can confirm a fix by re-running.

```bash
muraqib agent -p ./my-app --osv --max-issues 50   # AgentReport as JSON; exit 1 on blocking findings, 3 on scanner failure
muraqib context                                    # capabilities, modules, severity semantics
muraqib tool-schema                                # tool definitions (MCP / tool-use compatible)
muraqib audit --json                               # classic report as JSON (shorthand for --format json)
```

Programmatic use:

```typescript
import { runAuditForAgent, getSystemContext, AGENT_TOOL_DEFINITIONS, executeAgentTool } from "@muraqib/core";

const report = await runAuditForAgent({ projectRoot: process.cwd(), osv: true, maxIssues: 50 });
// { ok, verdict: "pass" | "fail", summary, modules, issues[], truncated }

await executeAgentTool("muraqib_audit", { projectRoot: "/app" }); // tool-call dispatcher
```

`runAuditForAgent` never throws or prints: if the audit cannot run it returns `{ ok: false, error }`. The engine has no dependency on the CLI renderers, so a VS Code extension can call the same API.
