/**
 * BaseGuard - Unified base class for all audit modules
 */

import type { AuditResult, AuditIssue, AuditContext, Finding } from "./types.js";

export abstract class BaseGuard {
  protected module: string;
  protected startTime: number = 0;
  protected context?: AuditContext;

  constructor(module: string, context?: AuditContext) {
    this.module = module;
    this.context = context;
  }

  abstract execute(): Promise<AuditResult>;

  async run(): Promise<AuditResult> {
    this.startTime = Date.now();
    try {
      return await this.execute();
    } catch (error) {
      return this.createErrorResult(error);
    }
  }

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

  protected ok(message: string): AuditResult {
    return this.createResult("ok", [], message);
  }

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

  protected log(message: string): void {
    console.log(`[${this.module}] ${message}`);
  }

  protected warn(message: string): void {
    console.warn(`[${this.module}] ⚠️  ${message}`);
  }

  protected error(message: string): void {
    console.error(`[${this.module}] ❌ ${message}`);
  }

  protected parseJSON<T>(json: string, fallback: T): T {
    try {
      return JSON.parse(json);
    } catch {
      return fallback;
    }
  }

  protected formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  }

  protected formatBytes(bytes: number): string {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
  }
}
