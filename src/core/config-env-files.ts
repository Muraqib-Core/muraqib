/**
 * Environment-file audit: tracked or unignored `.env` files holding secret-looking values.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { readDirEntries } from "../shared/fs-safe.js";
import { trackedEnvFiles, isGitIgnored } from "./helpers/git-protection.js";
import { isExposedEnvValue } from "./secret-detector.js";
import { getSensitiveMuraqibEnvKeys } from "./env-options.js";
import { ENV_FILE_PATTERN, ENV_TEMPLATE_PATTERN, parseEnvEntries } from "./helpers/env-parser.js";
import type { EnvEntry } from "./helpers/env-parser.js";
import type { ConfigIssue } from "./config-types.js";

/** Parses an env file into entries; returns `[]` when it cannot be read. */
function readEnvEntries(filePath: string): EnvEntry[] {
  try {
    return parseEnvEntries(readFileSync(filePath, "utf-8"));
  } catch {
    return [];
  }
}

/** Names of entries whose values look like real secrets (values are never reported). */
function exposedKeys(entries: readonly EnvEntry[], sensitiveKeys: ReadonlySet<string>): string[] {
  return entries.filter((e) => isExposedEnvValue(e.key, e.value, sensitiveKeys)).map((e) => e.key);
}

/** Lists non-template env files directly inside `root`. */
function localEnvFiles(root: string): string[] {
  return readDirEntries(root)
    .filter((d) => d.isFile() && ENV_FILE_PATTERN.test(d.name) && !ENV_TEMPLATE_PATTERN.test(d.name))
    .map((d) => d.name);
}

/**
 * Audits environment files (templates excluded):
 * - tracked by version control with secret-looking values -> critical `exposed_secret`;
 * - tracked without secret-looking values -> high `tracked_env_file`;
 * - present, not tracked, not ignored and holding secret-looking values -> high `exposed_secret`.
 * Ignored, untracked files are the normal local setup and are never reported. Secret values are
 * never copied into messages; only variable names are.
 */
export function checkEnvFiles(root: string, issues: ConfigIssue[], reports: string[]): void {
  const sensitiveKeys = new Set(getSensitiveMuraqibEnvKeys());
  const tracked = trackedEnvFiles(root, ENV_FILE_PATTERN, ENV_TEMPLATE_PATTERN);

  for (const file of tracked) {
    const entries = readEnvEntries(join(root, file));
    // An unreadable or empty env file exposes nothing, so it is not worth a finding.
    if (entries.length === 0) continue;
    const secrets = exposedKeys(entries, sensitiveKeys);
    if (secrets.length > 0) {
      issues.push({
        type: "exposed_secret",
        file,
        severity: "critical",
        message: `Environment file ${file} is tracked by version control and contains secret-looking values for: ${secrets.join(", ")}`,
        suggestion: `Rotate these secrets, untrack the file ("git rm --cached ${file}"), add it to .gitignore and purge it from history`,
      });
      reports.push(`🔴 Secrets committed in ${file}`);
    } else {
      issues.push({
        type: "tracked_env_file",
        file,
        severity: "high",
        message: `Environment file ${file} is tracked by version control and defines ${entries.length} variable(s)`,
        suggestion: `Untrack it ("git rm --cached ${file}"), add it to .gitignore and commit a .env.example template instead`,
      });
      reports.push(`🔴 Tracked environment file: ${file}`);
    }
  }

  for (const file of localEnvFiles(root)) {
    if (tracked.includes(file) || isGitIgnored(root, file)) continue;
    const secrets = exposedKeys(readEnvEntries(join(root, file)), sensitiveKeys);
    if (secrets.length === 0) continue;
    issues.push({
      type: "exposed_secret",
      file,
      severity: "high",
      message: `Environment file ${file} is not git-ignored and contains secret-looking values for: ${secrets.join(", ")}`,
      suggestion: `Add ${file} to .gitignore before committing and keep real secrets out of version control`,
    });
    reports.push(`⚠️ Unignored environment file with secrets: ${file}`);
  }
}
