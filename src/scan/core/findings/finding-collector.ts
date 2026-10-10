import type { ScanIssue } from "./finding.js";

export class FindingCollector {
  private findings: ScanIssue[] = [];

  add(finding: ScanIssue): void {
    this.findings.push(finding);
  }

  addMany(findings: ScanIssue[]): void {
    this.findings.push(...findings);
  }

  getAll(): ScanIssue[] {
    return [...this.findings];
  }

  getByCategory(category: ScanIssue["category"]): ScanIssue[] {
    return this.findings.filter((f) => f.category === category);
  }

  getBySeverity(severity: ScanIssue["level"]): ScanIssue[] {
    return this.findings.filter((f) => f.level === severity);
  }

  hasBlockingIssues(minimumSeverity: "high" | "medium" = "high"): boolean {
  const blocking =
    minimumSeverity === "medium"
      ? new Set(["critical", "high", "medium"])
      : new Set(["critical", "high"]);

  return this.findings.some((finding) =>
    blocking.has(finding.level)
  );
}

  clear(): void {
    this.findings = [];
  }
}
