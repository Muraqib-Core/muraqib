import fs from "fs";
import path from "path";
import { BaseGuard } from "../base-guard.js";
import type { AuditContext, AuditResult } from "../types.js";
import { performRenderBlockingAudit } from "./render-blocking.js";

/**
 * Checks the project's root index.html for scripts and stylesheets in `<head>` that block rendering.
 * Severity levels used: error (synchronous script), warning (stylesheet). No index.html means skipped.
 */
export class RenderBlockingGuard extends BaseGuard {
  private readonly targetPath: string;

  constructor(targetPath: string, context?: AuditContext) {
    super("render-blocking-guard", context);
    this.targetPath = targetPath;
  }

  async execute(): Promise<AuditResult> {
    const htmlPath = path.join(this.targetPath, "index.html");
    const html = fs.existsSync(htmlPath) ? fs.readFileSync(htmlPath, "utf-8") : "";
    if (!html) return this.skipped("No index.html found — nothing was measured");

    const blocking = performRenderBlockingAudit(html).criticalIssues.filter(
      (issue) => issue.type === "render_blocking_js" || issue.type === "render_blocking_css"
    );
    if (blocking.length === 0) return this.ok("No render-blocking resources in <head>");

    const issues = blocking.map((issue) => {
      const script = issue.type === "render_blocking_js";
      return this.createIssue(
        script ? "RENDER_BLOCKING_SCRIPT" : "RENDER_BLOCKING_STYLESHEET",
        script ? "error" : "warning",
        script ? "Render-blocking script" : "Render-blocking stylesheet",
        `${script ? "Render-blocking script" : "Render-blocking stylesheet"} in <head>: ${issue.resource}. ${issue.suggestion}`,
        { file: "index.html", ...(issue.line === undefined ? {} : { line: issue.line }) },
        issue.suggestion,
        ["performance", "render-blocking"]
      );
    });
    return this.issues(issues, `${issues.length} render-blocking resource(s) in <head>`);
  }
}
