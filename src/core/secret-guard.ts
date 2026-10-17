/**
 * SecretGuard - finds hardcoded secrets in a set of added lines.
 *
 * Unlike the other guards it does not walk the project: callers hand it the lines to inspect
 * (the git pre-commit hook passes the lines added in the staged diff), so only new content is
 * judged and a secret that was committed long ago never blocks an unrelated change.
 *
 * Severity levels:
 * - `critical`: almost certainly a real credential (live API token, private key, exposed `.env` value);
 *   these block a commit.
 * - `warning`: ambiguous or public-by-design (publishable keys, JWTs, `password = "..."`); reported
 *   but never blocking.
 *
 * A line containing `muraqib-ignore-secret` is skipped, so a false positive can be acknowledged
 * in the code that triggers it.
 */
import path from "path";
import { BaseGuard } from "./base-guard.js";
import { ENV_FILE_PATTERN, ENV_TEMPLATE_PATTERN, parseEnvEntries } from "./helpers/env-parser.js";
import { findSecrets, isExposedEnvValue } from "./secret-detector.js";
import type { SecretMatch } from "./secret-detector.js";
import type { AuditContext, AuditIssue, AuditResult } from "./types.js";

/** One added line of a file, with its 1-based line number in the new version. */
export interface ScannedLine {
  line: number;
  text: string;
}

/** The added lines of one file. */
export interface SecretScanTarget {
  /** Path relative to the repository root, using `/`. */
  file: string;
  lines: readonly ScannedLine[];
}

/** Options accepted by {@link SecretGuard}. */
export interface SecretGuardOptions {
  targets: readonly SecretScanTarget[];
  /** Lines longer than this are skipped as generated or minified code (default 2000). */
  maxLineLength?: number;
  /** Stop scanning after this many characters of added text (default 4 MiB). */
  maxScanChars?: number;
}

/** Inline marker that suppresses findings on its line. */
export const SECRET_IGNORE_MARKER = "muraqib-ignore-secret";

const DEFAULT_MAX_LINE_LENGTH = 2000;
const DEFAULT_MAX_SCAN_CHARS = 4 * 1024 * 1024;

const SKIPPED_BASENAMES = new Set(["package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "pnpm-lock.yaml", "bun.lock", "bun.lockb"]);
const SKIPPED_FILE_PATTERN = /\.(?:min\.(?:js|css)|map|lock|png|jpe?g|gif|webp|ico|pdf|zip|gz|woff2?|ttf|eot|mp[34]|wasm)$/i;

const RECOMMENDATION =
  `Remove the secret from the change and load it from the environment instead. If it was ever pushed, rotate it. ` +
  `For a false positive, add \`${SECRET_IGNORE_MARKER}\` to the line.`;

/** Whether a file's content is worth scanning (lockfiles, minified bundles and binaries are not). */
export function isScannableFile(file: string): boolean {
  return !SKIPPED_BASENAMES.has(path.posix.basename(file)) && !SKIPPED_FILE_PATTERN.test(file);
}

/** One secret can match several rules (`DB_PASSWORD="..."` is both a password and a database credential); keep the strongest. */
function reportable(matches: readonly SecretMatch[]): SecretMatch[] {
  return matches.some((match) => match.blocking) ? matches.filter((match) => match.blocking) : [...matches];
}

function isEnvFile(file: string): boolean {
  const base = path.posix.basename(file);
  return ENV_FILE_PATTERN.test(base) && !ENV_TEMPLATE_PATTERN.test(base);
}

/** Detects secrets in added lines and reports them as {@link AuditIssue}s (see the file header). */
export class SecretGuard extends BaseGuard {
  private readonly options: SecretGuardOptions;

  constructor(options: SecretGuardOptions, context?: AuditContext) {
    super("secret-guard", context);
    this.options = options;
  }

  async execute(): Promise<AuditResult> {
    const issues: AuditIssue[] = [];
    let budget = this.options.maxScanChars ?? DEFAULT_MAX_SCAN_CHARS;
    let skipped = 0;
    for (const target of this.options.targets) {
      if (!isScannableFile(target.file)) continue;
      if (budget <= 0) {
        skipped += 1;
        continue;
      }
      budget -= target.lines.reduce((sum, line) => sum + line.text.length, 0);
      issues.push(...this.scanTarget(target));
    }
    if (skipped > 0) issues.push(this.incompleteScanIssue(skipped));
    return this.issues(issues, this.summarize(issues));
  }

  private incompleteScanIssue(skipped: number): AuditIssue {
    return this.createIssue(
      "SECRET_SCAN_INCOMPLETE",
      "warning",
      "Secret scan incomplete",
      `${skipped} file(s) were not scanned because the change is too large to scan quickly.`,
      undefined,
      "Run `muraqib audit` to scan the whole project.",
      ["security", "secrets"]
    );
  }

  private summarize(issues: readonly AuditIssue[]): string {
    const blocking = issues.filter((issue) => issue.severity === "critical").length;
    if (issues.length === 0) return "No secrets found";
    return blocking > 0 ? `${blocking} secret(s) found that block the change` : `${issues.length} possible secret(s) found`;
  }

  private scanTarget(target: SecretScanTarget): AuditIssue[] {
    const maxLength = this.options.maxLineLength ?? DEFAULT_MAX_LINE_LENGTH;
    const envFile = isEnvFile(target.file);
    const issues: AuditIssue[] = [];
    for (const { line, text } of target.lines) {
      if (text.length > maxLength || text.includes(SECRET_IGNORE_MARKER)) continue;
      const matches = reportable(findSecrets(text, { file: target.file, line, includeHeuristics: false, ignorePlaceholders: true }));
      issues.push(...matches.map((match) => this.matchIssue(match, target.file, line)));
      if (envFile && matches.length === 0 && this.hasExposedEnvValue(text)) issues.push(this.envIssue(target.file, line));
    }
    return issues;
  }

  private hasExposedEnvValue(text: string): boolean {
    return parseEnvEntries(text).some((entry) => isExposedEnvValue(entry.key, entry.value, new Set()));
  }

  private matchIssue(match: SecretMatch, file: string, line: number): AuditIssue {
    const blocking = match.blocking;
    return this.createIssue(
      `SECRET_${match.type.toUpperCase()}`,
      blocking ? "critical" : "warning",
      blocking ? "Hardcoded secret" : "Possible secret",
      `${match.description} (${match.pattern}) at ${file}:${line}`,
      { file, line },
      RECOMMENDATION,
      ["security", "secrets", match.type]
    );
  }

  private envIssue(file: string, line: number): AuditIssue {
    return this.createIssue(
      "SECRET_ENV_VALUE",
      "critical",
      "Hardcoded secret",
      `An environment file entry that looks like a real secret value at ${file}:${line} (value hidden)`,
      { file, line },
      `Do not commit real secrets in ${path.posix.basename(file)}; keep it out of version control and commit a template such as .env.example instead.`,
      ["security", "secrets", "env"]
    );
  }
}
