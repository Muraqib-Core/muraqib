import type { AuditReport } from "./types.js";
import type { ScanAuditMetadata } from "../core/types.js";

/** Report modules are loosely typed for third-party guards; only read known scan metadata. */
export function scanCoverageLines(report: AuditReport): string[] {
  const data = report.modules["scan"];
  if (typeof data !== "object" || data === null || !("scan" in data) || !data.scan) return [];
  const scan = data.scan as ScanAuditMetadata;
  const lines = [`Scan policy: ${scan.mode}; exit code: ${scan.exitCode}`];
  for (const coverage of scan.scannerCoverage) {
    lines.push(`${coverage.scanner}: ${coverage.status}`);
    if (coverage.scannedInputs.length) lines.push(`  Scanned: ${coverage.scannedInputs.join(", ")}`);
    if (coverage.skippedInputs.length) lines.push(`  Skipped: ${coverage.skippedInputs.join(", ")}`);
    for (const diagnostic of coverage.diagnostics) lines.push(`  Diagnostic: ${diagnostic}`);
  }
  return lines;
}
