import type { AuditReport } from "../../core/runner/audit-runner.js";

export function renderJsonReport(report: AuditReport): void {
  const output = {
    schemaVersion: "1.1",
    timestamp: new Date().toISOString(),
    status: report.exitCode === 0 ? "passed" : "failed",
    exitCode: report.exitCode,
    summary: {
      totalFindings: report.findings.length,
      scannedFiles: report.scannedEnvFiles,
      parsedLines: report.totalParsedLines,
      engine: report.engine,
      mode: report.mode,
    },
    findings: report.findings,
    scannerCoverage: report.scannerCoverage,
    aiAdvisory: report.aiAdvisory,
  };

  console.log(JSON.stringify(output, null, 2));
}
