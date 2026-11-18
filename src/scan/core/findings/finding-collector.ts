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
   * All collected findings.
   *
   * @returns A copy of the list, in the order they were added
   */
  getAll(): ScanIssue[] {
    return [...this.findings];
  }

  /**
   * Findings of one category.
   *
   * @param category - Category to keep
   * @returns The matching findings
   */
  getByCategory(category: ScanIssue["category"]): ScanIssue[] {
    return this.findings.filter((f) => f.category === category);
  }

  /**
   * Findings of one severity level.
   *
   * @param severity - Level to keep
   * @returns The matching findings
   */
  getBySeverity(severity: ScanIssue["level"]): ScanIssue[] {
    return this.findings.filter((f) => f.level === severity);
  }

  /**
   * Whether any finding is severe enough to block the build.
   *
   * @param minimumSeverity - `high` blocks on critical and high findings, `medium` also blocks on medium ones
   * @returns True when at least one finding blocks
   */
  hasBlockingIssues(minimumSeverity: "high" | "medium" = "high"): boolean {
    const blocking: ReadonlySet<string> =
      minimumSeverity === "medium" ? new Set(["critical", "high", "medium"]) : new Set(["critical", "high"]);
    return this.findings.some((finding) => blocking.has(finding.level));
  }

  /**
   * Clear.
   */
  clear(): void {
    this.findings = [];
  }
}
