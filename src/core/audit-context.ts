/**
 * Builds an AuditContext for a project (git + runtime metadata).
 * Shared by the CLI and the programmatic runAudit() API.
 */

import { execFileSync } from "child_process";
import type { AuditContext } from "./types.js";

let cachedNpmVersion: string | undefined;

/** True when the CI env var is set to a meaningful value ("", "0", "false" mean not-CI). */
function isCi(value: string | undefined): boolean {
  if (value === undefined) return false;
  const v = value.trim().toLowerCase();
  return v !== "" && v !== "0" && v !== "false";
}

/** npm --version is cwd-independent, so it is probed once per process. On win32 npm is npm.cmd, which needs a shell to launch. */
function npmVersion(cwd: string): string | undefined {
  if (cachedNpmVersion !== undefined) return cachedNpmVersion;
  const isWin = process.platform === "win32";
  const found = tryExec(isWin ? "npm.cmd" : "npm", ["--version"], cwd, isWin);
  if (found !== undefined) cachedNpmVersion = found;
  return found;
}

/** @internal Reset the cached npm version (tests only). */
export function resetNpmVersionCache(): void {
  cachedNpmVersion = undefined;
}

function tryExec(cmd: string, args: string[], cwd: string, shell = false): string | undefined {
  try {
    return execFileSync(cmd, args, { cwd, stdio: ["ignore", "pipe", "ignore"], timeout: 5000, shell })
      .toString()
      .trim();
  } catch {
    return undefined;
  }
}

/**
 * Build audit context.
 *
 * @param projectRoot - Project root
 * @returns Build audit context result
 */
export function buildAuditContext(projectRoot: string = process.cwd()): AuditContext {
  const env = isCi(process.env.CI) ? "ci" : process.env.NODE_ENV === "production" ? "production" : "development";
  return {
    projectRoot,
    timestamp: Date.now(),
    environment: env,
    nodeVersion: process.version,
    npmVersion: npmVersion(projectRoot) ?? "unknown",
    gitBranch: tryExec("git", ["rev-parse", "--abbrev-ref", "HEAD"], projectRoot),
    gitCommit: tryExec("git", ["rev-parse", "HEAD"], projectRoot),
  };
}
