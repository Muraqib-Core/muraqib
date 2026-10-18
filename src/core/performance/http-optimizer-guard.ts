import fs from "fs";
import path from "path";
import { BaseGuard } from "../base-guard.js";
import type { AuditContext, AuditResult } from "../types.js";
import { analyzeHttpProfile } from "./optimizer-engine.js";
import { probeHttp } from "./http-probe.js";

const RESOURCE_PATTERN = /\.(js|css|png|jpe?g|svg|gif|webp|ico|html|woff2?)$/i;

/** Number of static resources under `dir`, skipping `node_modules` and dot directories; unreadable directories count as empty. */
function countResources(dir: string): number {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  let count = 0;
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    if (entry.isDirectory()) count += countResources(path.join(dir, entry.name));
    else if (entry.isFile() && RESOURCE_PATTERN.test(entry.name)) count++;
  }
  return count;
}

/**
 * Probes a live URL for its HTTP protocol and cookie size and weighs them against the project's resource count.
 * Severity levels used: warning (an unreachable URL is reported as an error, never as a pass).
 */
export class HttpOptimizerGuard extends BaseGuard {
  private readonly targetPath: string;
  private readonly url: string;

  constructor(targetPath: string, url: string, context?: AuditContext) {
    super("http-optimizer-guard", context);
    this.targetPath = targetPath;
    this.url = url;
  }

  async execute(): Promise<AuditResult> {
    const probe = await probeHttp(this.url);
    if (!probe.reachable) {
      const issue = this.createIssue(
        "HTTP_PROBE_UNREACHABLE",
        "error",
        "HTTP probe failed",
        `تعذّر قياس البروتوكول والكوكيز: لا يمكن الوصول إلى ${this.url} (${probe.error})`,
        undefined,
        "Make sure the URL is reachable from where the audit runs.",
        ["performance", "http"]
      );
      return this.issues([issue], `${this.url} is unreachable`);
    }

    const { issues } = analyzeHttpProfile(countResources(this.targetPath), probe.protocol, probe.cookiesSizeBytes);
    if (issues.length === 0) return this.ok("HTTP protocol and cookie settings are optimal");
    return this.issues(
      issues.map((message) => this.createIssue("HTTP_PROFILE", "warning", "HTTP profile issue", message, undefined, undefined, ["performance", "http"])),
      `${issues.length} HTTP profile issue(s)`
    );
  }
}
