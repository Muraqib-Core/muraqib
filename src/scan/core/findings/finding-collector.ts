import type { ScanIssue } from "./finding.js";

/**
 * Finding collector class.
 */
export class FindingCollector {
  private findings: ScanIssue[] = [];

  /**
   * Add.
   *
   * @param finding - Finding
   */
  add(finding: ScanIssue): void {
    this.findings.push(finding);
  }

  /**
   * Add many.
   *
   * @param findings - Findings
   */
  addMany(findings: ScanIssue[]): void {
    this.findings.push(...findings);
  }

  /**
   * Get all.
   *
   * @returns Get all result
   */
  getAll(): ScanIssue[] {
    return [...this.findings];
  }

  /**
   * Get by category.
   *
   * @param category - Category
   * @returns Get by category result
   */
  getByCategory(category: ScanIssue["category"]): ScanIssue[] {
    return this.findings.filter((f) => f.category === category);
  }

  /**
   * Get by severity.
   *
   * @param severity - Severity
   * @returns Get by severity result
   */
  getBySeverity(severity: ScanIssue["level"]): ScanIssue[] {
    return this.findings.filter((f) => f.level === severity);
  }

  /**
   * Has blocking issues.
   *
   * @param minimumSeverity - Minimum severity
   * @returns Has blocking issues result
   */
  hasBlockingIssues(minimumSeverity: "high" | "medium" = "high"): boolean {
  const blocking =
    minimumSeverity === "medium"
      ? new Set(["critical", "high", "medium"])
      : new Set(["critical", "high"]);

  return this.findings.some((finding) =>
    blocking.has(finding.level)
  );
}

  /**
   * Clear.
   */
  clear(): void {
    this.findings = [];
  }
}
