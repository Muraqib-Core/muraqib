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

import type { AuditResult, AuditIssue, AuditContext, Finding } from "./types.js";

export abstract class BaseGuard {
  protected module: string;
  protected startTime: number = 0;
  protected context?: AuditContext;

  /**
   * Initialize a BaseGuard instance
   * @param module - The name of the audit module (e.g., 'memory-guard', 'security-guard')
   * @param context - Optional AuditContext with project metadata
   */
  constructor(module: string, context?: AuditContext) {
    this.module = module;
    this.context = context;
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
    this.startTime = Date.now();
    try {
      return await this.execute();
    } catch (error) {
      return this.createErrorResult(error);
    }
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
    const duration = Date.now() - this.startTime;
    return {
      status,
      module: this.module,
      issues,
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
    const status = hasCritical ? "error" : hasErrors ? "issues" : "warning";

    return this.createResult(
      status,
      issues,
      message || `Found ${issues.length} ${status}`
    );
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
    };
  }

  /**
   * Convert audit result issues to Finding objects
   * @param result - AuditResult to convert
   * @returns Array of Finding objects
   */
  protected toFindings(result: AuditResult): Finding[] {
    return result.issues.map((issue, index) => ({
      id: `${this.module}-${index}`,
      type: issue.code,
      severity: issue.severity,
      title: issue.title,
      description: issue.message,
      file: issue.location?.file,
      line: issue.location?.line,
      resolution: issue.recommendation,
      tags: [this.module, ...issue.tags],
      createdAt: result.timestamp,
    }));
  }

  /**
   * Log an info message with module prefix
   * @param message - Message to log
   */
  protected log(message: string): void {
    console.log(`[${this.module}] ${message}`);
  }

  /**
   * Log a warning message with module prefix
   * @param message - Message to log
   */
  protected warn(message: string): void {
    console.warn(`[${this.module}] ⚠️  ${message}`);
  }

  /**
   * Log an error message with module prefix
   * @param message - Message to log
   */
  protected error(message: string): void {
    console.error(`[${this.module}] ❌ ${message}`);
  }

  /**
   * Safely parse JSON with fallback value
   * @param json - JSON string to parse
   * @param fallback - Value to return on parse error
   * @returns Parsed object or fallback
   */
  protected parseJSON<T>(json: string, fallback: T): T {
    try {
      return JSON.parse(json);
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
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  }

  /**
   * Format bytes as human-readable size
   * @param bytes - Size in bytes
   * @returns Formatted string (e.g., "1.50 MB")
   */
  protected formatBytes(bytes: number): string {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
  }
}
