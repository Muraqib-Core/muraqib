/**
 * BaseGuard - Unified base class for all audit modules
 *
 * Provides a standardized interface for implementing custom audit guards.
 * Each guard performs a specific type of audit (memory, security, dependencies, etc.)
 * and returns structured results with severity-classified issues.
 *
 * @example
 * ```typescript
 * class CustomGuard extends BaseGuard {
 *   constructor(context?: AuditContext) {
 *     super('custom-guard', context);
 *   }
 *
 *   async execute(): Promise<AuditResult> {
 *     // Implement audit logic
 *     if (someCondition) {
 *       const issue = this.createIssue(
 *         'CUSTOM_001',
 *         'warning',
 *         'Custom Issue',
 *         'Issue description',
 *         undefined,
 *         'Recommended fix'
 *       );
 *       return this.issues([issue]);
 *     }
 *     return this.ok('No issues found');
 *   }
 * }
 * ```
 */

import type { AuditResult, AuditIssue, AuditContext, GuardFinding } from "./types.js";
import * as logger from "../shared/logger.js";

/**
 * Base guard class.
 * Severity levels used: warning, error, critical, info.
 */
export abstract class BaseGuard {
  protected readonly module: string;
  /** Fallback start time used when execute() is invoked directly (not through run()). */
  protected startTime: number;
  protected context?: AuditContext | undefined;

  /**
   * Initialize a BaseGuard instance
   * @param module - The name of the audit module (e.g., 'memory-guard', 'security-guard')
   * @param context - Optional AuditContext with project metadata
   */
  constructor(module: string, context?: AuditContext) {
    this.module = module;
    this.context = context;
    this.startTime = Date.now();
  }

  /**
   * Public name of this guard (the module identifier given to the constructor).
   * @returns The module name, e.g. 'memory-guard'
   */
  getModule(): string {
    return this.module;
  }

  /** Readonly alias of {@link getModule}. */
  get name(): string {
    return this.module;
  }

  /**
   * Execute the audit logic. Must be implemented by subclasses.
   * @returns Promise resolving to an AuditResult with findings
   */
  abstract execute(): Promise<AuditResult>;

  /**
   * Run the guard with automatic error handling and timing
   * Wraps execute() to measure duration and catch errors
   * @returns Promise resolving to an AuditResult (even on error)
   */
  async run(): Promise<AuditResult> {
    // Local start: safe when several run() calls overlap on one instance.
    const start = Date.now();
    this.startTime = start;
    let result: AuditResult;
    try {
      result = await this.execute();
    } catch (error) {
      result = this.createErrorResult(error);
    }
    return { ...result, duration: Math.max(0, Date.now() - start) };
  }

  /** Copy issues, stamping this guard's module on those lacking one (inputs are never mutated). */
  private stampModule(issues: readonly AuditIssue[]): AuditIssue[] {
    return issues.map((issue) => (issue.module === undefined ? { ...issue, module: this.module } : issue));
  }

  /**
   * Create a structured AuditResult
   * @param status - Result status: 'ok' | 'warning' | 'issues' | 'error'
   * @param issues - Array of AuditIssue objects found
   * @param message - Human-readable result message
   * @returns Structured AuditResult with metadata
   */
  protected createResult(
    status: AuditResult["status"],
    issues: AuditIssue[],
    message: string
  ): AuditResult {
    const duration = Math.max(0, Date.now() - this.startTime);
    return {
      status,
      module: this.module,
      issues: this.stampModule(issues),
      message,
      timestamp: Date.now(),
      duration,
    };
  }

  /**
   * Return a successful audit result with no issues
   * @param message - Success message
   * @returns AuditResult with status 'ok'
   */
  protected ok(message: string): AuditResult {
    return this.createResult("ok", [], message);
  }

  /**
   * Return an audit result with detected issues
   * Automatically determines status based on issue severity
   * @param issues - Array of issues found
   * @param message - Optional custom message
   * @returns AuditResult with appropriate status and issues
   */
  protected issues(issues: AuditIssue[], message?: string): AuditResult {
    const hasErrors = issues.some((i) => i.severity === "error");
    const hasCritical = issues.some((i) => i.severity === "critical");
    const hasWarnings = issues.some((i) => i.severity === "warning");
    const status: AuditResult["status"] = hasCritical
      ? "error"
      : hasErrors
        ? "issues"
        : hasWarnings
          ? "warning"
          : "ok";
    const fallback = issues.length === 0 ? "No issues found" : `Found ${issues.length} issue(s)`;

    return this.createResult(status, issues, message ?? fallback);
  }

  /**
   * Convert structured guard findings into issues sharing one title and recommendation.
   * @param findings - Findings produced by the guard's internal audit
   * @param title - Issue title applied to every finding
   * @param recommendation - Remediation suggestion applied to every finding
   * @returns One AuditIssue per finding, in the same order
   */
  protected issuesFromFindings(findings: readonly GuardFinding[], title: string, recommendation: string): AuditIssue[] {
    return findings.map((finding) => {
      const { file, line } = finding;
      const location = file === undefined ? undefined : { file, ...(line === undefined ? {} : { line }) };
      return this.createIssue(finding.code, finding.severity, title, finding.message, location, recommendation);
    });
  }

  /**
   * Create an error result from a caught exception
   * @param error - The error object or message
   * @returns AuditResult with error status and issue
   */
  protected createErrorResult(error: unknown): AuditResult {
    const message = error instanceof Error ? error.message : String(error);
    const issue: AuditIssue = {
      code: "GUARD_ERROR",
      severity: "error",
      title: `${this.module} Error`,
      message,
      recommendation: "Check logs for details",
      tags: [],
      module: this.module,
    };

    return this.createResult("error", [issue], message);
  }

  /**
   * Create a structured audit issue
   * @param code - Issue code identifier (e.g., 'MEMORY_001')
   * @param severity - Severity level: 'critical' | 'error' | 'warning' | 'info'
   * @param title - Short issue title
   * @param message - Detailed issue description
   * @param location - Optional source location (file, line)
   * @param recommendation - Optional remediation suggestion
   * @param tags - Optional tags for categorization
   * @returns Structured AuditIssue
   */
  protected createIssue(
    code: string,
    severity: AuditIssue["severity"],
    title: string,
    message: string,
    location?: AuditIssue["location"],
    recommendation?: string,
    tags?: string[]
  ): AuditIssue {
    return {
      code,
      severity,
      title,
      message,
      location,
      recommendation,
      tags: tags ?? [],
      module: this.module,
    };
  }

  /**
   * Log an info message with module prefix
   * @param message - Message to log
   */
  protected log(message: string): void {
    logger.log(`[${this.module}] ${message}`);
  }

  /**
   * Log a warning message with module prefix
   * @param message - Message to log
   */
  protected warn(message: string): void {
    logger.warn(`[${this.module}] ⚠️  ${message}`);
  }

  /**
   * Log an error message with module prefix
   * @param message - Message to log
   */
  protected error(message: string): void {
    logger.error(`[${this.module}] ❌ ${message}`);
  }

  /**
   * Safely parse JSON with fallback value
   * @param json - JSON string to parse
   * @param fallback - Value to return on parse error
   * @returns Parsed object or fallback
   */
  protected parseJSON<T>(json: string, fallback: T): T {
    try {
      const parsed: unknown = JSON.parse(json);
      return parsed as T;
    } catch {
      return fallback;
    }
  }

  /**
   * Format milliseconds as human-readable duration
   * @param ms - Duration in milliseconds
   * @returns Formatted string (e.g., "1.25s" or "500ms")
   */
  protected formatDuration(ms: number): string {
    if (!Number.isFinite(ms) || ms <= 0) return "0ms";
    if (ms < 1000) return `${Math.round(ms)}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  }

  /**
   * Format bytes as human-readable size
   * @param bytes - Size in bytes
   * @returns Formatted string (e.g., "1.50 MB"); "N/A" for NaN/Infinity
   */
  protected formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes)) return "N/A";
    if (bytes === 0) return "0 B";
    const sign = bytes < 0 ? "-" : "";
    const abs = Math.abs(bytes);
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB", "PB"];
    const i = Math.min(sizes.length - 1, Math.max(0, Math.floor(Math.log(abs) / Math.log(k))));
    return `${sign}${(abs / Math.pow(k, i)).toFixed(2)} ${sizes[i] ?? "B"}`;
  }
}
