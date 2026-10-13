/**
 * Single place where types are borrowed from the ESM-only `muraqib-core` package. A CommonJS
 * module (the extension) may only type-import an ES module with an explicit resolution mode,
 * so the attribute lives here instead of in every file.
 */
export type {
  AgentAuditOptions,
  AgentIssue,
  AgentModuleSummary,
  AgentReport,
  AgentSeverity,
} from "muraqib-core" with { "resolution-mode": "import" };
