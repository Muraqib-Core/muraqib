/**
 * Builds an AuditContext for a project (git + runtime metadata).
 * Shared by the CLI and the programmatic runAudit() API.
 */

import { execFileSync } from "child_process";
import type { AuditContext } from "./types.js";

function tryExec(cmd: string, args: string[], cwd: string): string | undefined {
  try {
    return execFileSync(cmd, args, { cwd, stdio: ["ignore", "pipe", "ignore"], timeout: 5000 })
      .toString()
      .trim();
  } catch {
    return undefined;
  }
}

export function buildAuditContext(projectRoot: string = process.cwd()): AuditContext {
  const env = process.env.CI ? "ci" : process.env.NODE_ENV === "production" ? "production" : "development";
  return {
    projectRoot,
    timestamp: Date.now(),
    environment: env,
    nodeVersion: process.version,
    npmVersion: tryExec("npm", ["--version"], projectRoot) ?? "unknown",
    gitBranch: tryExec("git", ["rev-parse", "--abbrev-ref", "HEAD"], projectRoot),
    gitCommit: tryExec("git", ["rev-parse", "HEAD"], projectRoot),
  };
}
