import type { AgentIssue, AgentReport, AgentSeverity } from "./types.js";
import { resolveInsideRoot, type PathApi } from "./path-safety.js";
import * as nodePath from "node:path";

/** Severity levels of the Problems panel, independent of the `vscode` enum. */
export type DiagnosticLevel = "error" | "warning" | "information";

/** A VS Code-agnostic diagnostic; the host adapter converts it to `vscode.Diagnostic`. */
export interface DiagnosticSpec {
  /** Absolute path of the file, guaranteed to be inside the workspace root. */
  path: string;
  /** Zero-based line. */
  line: number;
  /** Zero-based column. */
  column: number;
  level: DiagnosticLevel;
  message: string;
  code: string;
  module: string;
  issueId: string;
}

const LEVELS: Record<AgentSeverity, DiagnosticLevel> = {
  critical: "error",
  error: "error",
  warning: "warning",
  info: "information",
};

/** Map a Muraqib severity to a Problems-panel level (critical and error both show as errors). */
export function toDiagnosticLevel(severity: AgentSeverity): DiagnosticLevel {
  return LEVELS[severity] ?? "information";
}

function zeroBased(value: number | undefined): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 ? value - 1 : 0;
}

function describe(issue: AgentIssue): string {
  const head = issue.title === "" || issue.title === issue.message ? issue.message : `${issue.title}: ${issue.message}`;
  return issue.recommendation !== undefined && issue.recommendation !== "" ? `${head}\n${issue.recommendation}` : head;
}

/**
 * Convert report issues that have a file into diagnostics grouped by absolute path.
 * Issues without a file, or whose file resolves outside `root`, are skipped. A missing line
 * maps to the first line so the problem is still listed against its file.
 */
export function mapIssuesToDiagnostics(
  report: Pick<AgentReport, "issues">,
  root: string,
  api: PathApi = nodePath
): Map<string, DiagnosticSpec[]> {
  const byPath = new Map<string, DiagnosticSpec[]>();
  const seen = new Set<string>();
  for (const issue of report.issues) {
    if (typeof issue.file !== "string" || seen.has(issue.id)) continue;
    const path = resolveInsideRoot(root, issue.file, api);
    if (path === undefined) continue;
    seen.add(issue.id);
    const spec: DiagnosticSpec = {
      path,
      line: zeroBased(issue.line),
      column: zeroBased(issue.column),
      level: toDiagnosticLevel(issue.severity),
      message: describe(issue),
      code: issue.code,
      module: issue.module,
      issueId: issue.id,
    };
    const list = byPath.get(path);
    if (list === undefined) byPath.set(path, [spec]);
    else list.push(spec);
  }
  return byPath;
}

/** Set of `issue.file` strings in the report: the only paths the host will open on request. */
export function collectReportedFiles(report: Pick<AgentReport, "issues">): Set<string> {
  const files = new Set<string>();
  for (const issue of report.issues) if (typeof issue.file === "string") files.add(issue.file);
  return files;
}
