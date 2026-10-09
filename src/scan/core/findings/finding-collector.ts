import type { Finding } from "./finding.js";

export class FindingCollector {
  private findings: Finding[] = [];

  add(finding: Finding): void {
    this.findings.push(finding);
  }

  addMany(findings: Finding[]): void {
    this.findings.push(...findings);
  }

  getAll(): Finding[] {
    return [...this.findings];
  }

  getByCategory(category: Finding["category"]): Finding[] {
    return this.findings.filter((f) => f.category === category);
  }

  getBySeverity(severity: Finding["severity"]): Finding[] {
    return this.findings.filter((f) => f.severity === severity);
  }

  hasBlockingIssues(minimumSeverity: "high" | "medium" = "high"): boolean {
  const blocking =
    minimumSeverity === "medium"
      ? new Set(["critical", "high", "medium"])
      : new Set(["critical", "high"]);

  return this.findings.some((finding) =>
    blocking.has(finding.severity)
  );
}

  clear(): void {
    this.findings = [];
  }
}
