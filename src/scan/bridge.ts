/**
 * Bridge between the scan layer (Jenan's Finding model / AuditRunner) and the guard layer
 * (Aya's AuditIssue / AuditResult), so both feed one unified report.
 */
import type { AuditIssue, AuditResult } from "../core/types.js";
import type { Finding } from "./core/findings/finding.js";
import { createProjectContext } from "./core/context/project-context.js";
import { AuditRunner, type AuditReport as ScanReport } from "./core/runner/audit-runner.js";

const SEVERITY_MAP: Record<Finding["severity"], AuditIssue["severity"]> = {
  critical: "critical",
  high: "error",
  medium: "warning",
  low: "info",
  info: "info",
};

export function findingToAuditIssue(f: Finding): AuditIssue {
  const issue: AuditIssue = {
    code: f.id,
    severity: SEVERITY_MAP[f.severity],
    title: f.title,
    message: f.message,
    tags: [f.source, f.category, ...(f.confidence ? [f.confidence] : [])],
  };
  if (f.remediation) issue.recommendation = f.remediation;
  if (f.file) {
    issue.location = { file: f.file, ...(f.line !== undefined ? { line: f.line } : {}) };
  }
  return issue;
}

export interface ScanAuditOptions {
  enableAi?: boolean;
  dockerNative?: boolean;
  mode?: "build" | "prod";
}

export interface ScanAuditOutcome {
  result: AuditResult;
  report: ScanReport;
}

/** Run Jenan's AuditRunner (env files, OSV, compatibility, Docker, optional AI) and map to an AuditResult. */
export async function runScanAudit(projectRoot: string, options: ScanAuditOptions = {}): Promise<ScanAuditOutcome> {
  const started = Date.now();
  const context = createProjectContext(projectRoot);
  const report = await new AuditRunner().run(context, {
    mode: options.mode ?? "build",
    enableAi: options.enableAi ?? false,
    dockerNative: options.dockerNative ?? false,
  });
  const issues = report.findings.map(findingToAuditIssue);
  const failed = report.exitCode === 3;
  const result: AuditResult = {
    status: failed ? "error" : issues.length === 0 ? "ok" : issues.some((i) => i.severity === "critical" || i.severity === "error") ? "issues" : "warning",
    module: "scan",
    issues,
    message: failed
      ? "Scan layer could not complete reliably"
      : `Scan layer: ${issues.length} finding(s) across ${report.scannerCoverage.length} scanner(s)`,
    timestamp: Date.now(),
    duration: Date.now() - started,
  };
  return { result, report };
}
