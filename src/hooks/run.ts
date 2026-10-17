/**
 * What the installed git hooks execute.
 *
 * Exit codes: `1` blocks the git operation (findings); `0` lets it continue. Anything that stops
 * Muraqib from checking at all (not a git repository, git failing, a scanner that cannot reach the
 * network) is reported as a warning and does not block: a broken hook must never trap a developer.
 */
import { auditExitCode } from "../core/audit-exit-code.js";
import { runGit } from "../core/helpers/git-protection.js";
import { SecretGuard } from "../core/secret-guard.js";
import type { AuditIssue, AuditResult } from "../core/types.js";
import { SKIP_ENV } from "./hook-script.js";
import { readStagedAdditions } from "./staged.js";

/** Where hook output goes (stderr in real use; git shows it to the developer). */
export interface HookIo {
  out(message: string): void;
  err(message: string): void;
}

const consoleIo: HookIo = {
  out: (message) => console.log(message),
  err: (message) => console.error(message),
};

/** Runs the audit checks and returns their results; replaceable so tests need no network. */
export type PrePushAudit = (gitRoot: string) => Promise<readonly AuditResult[]>;

const defaultPrePushAudit: PrePushAudit = async (gitRoot) => {
  const [{ ConfigGuard }, { runScanAudit }] = await Promise.all([import("../core/config-guard.js"), import("../scan/bridge.js")]);
  const [config, scan] = await Promise.all([new ConfigGuard({ projectRoot: gitRoot }).run(), runScanAudit(gitRoot)]);
  return [config, scan.result];
};

function findGitRoot(cwd: string): string | undefined {
  const { status, stdout } = runGit(["rev-parse", "--show-toplevel"], cwd);
  const root = stdout.trim();
  return status === 0 && root !== "" ? root : undefined;
}

/**
 * Format the secret findings of a pre-commit run.
 *
 * @param result - Result of the {@link SecretGuard}
 * @returns Lines to print (empty when there is nothing to report)
 */
export function renderPreCommitReport(result: AuditResult): string[] {
  if (result.issues.length === 0) return [];
  const blocking = result.issues.filter((issue) => issue.severity === "critical");
  const lines = [
    blocking.length > 0
      ? `muraqib: commit blocked, ${blocking.length} secret(s) in the staged changes`
      : `muraqib: ${result.issues.length} possible secret(s) in the staged changes (not blocking)`,
  ];
  for (const issue of result.issues) {
    lines.push(`  ${issue.severity === "critical" ? "✖" : "⚠"} ${issue.message}`);
  }
  if (blocking.length > 0) {
    lines.push(
      "Remove the secret from the change (rotate it if it was ever pushed).",
      "False positive? Add `muraqib-ignore-secret` to the line, or bypass once with `git commit --no-verify`."
    );
  }
  return lines;
}

/**
 * Pre-commit: scan only the staged changes for secrets.
 *
 * @param cwd - Directory git ran the hook in (the repository root)
 * @param env - Environment (`MURAQIB_SKIP_HOOKS` skips the check)
 * @param io - Output sink
 * @returns 1 to block the commit, otherwise 0
 */
export async function runPreCommit(cwd: string, env: NodeJS.ProcessEnv = process.env, io: HookIo = consoleIo): Promise<number> {
  if (env[SKIP_ENV]) return 0;
  const gitRoot = findGitRoot(cwd);
  if (gitRoot === undefined) {
    io.err("muraqib: not inside a git repository, skipping the pre-commit check");
    return 0;
  }
  try {
    const result = await new SecretGuard({ targets: readStagedAdditions(gitRoot) }).run();
    for (const line of renderPreCommitReport(result)) io.err(line);
    return auditExitCode([result]) === 1 ? 1 : 0;
  } catch (error) {
    io.err(`muraqib: could not check the staged changes (${error instanceof Error ? error.message : String(error)}), allowing the commit`);
    return 0;
  }
}

/** Config-guard findings that are about leaked secrets; its other findings are project hygiene. */
const SECURITY_CONFIG_CODES: ReadonlySet<string> = new Set(["CONFIG_EXPOSED_SECRET", "CONFIG_TRACKED_ENV_FILE"]);

const isBlockingSeverity = (issue: AuditIssue): boolean => issue.severity === "critical" || issue.severity === "error";

/** What the pre-push audit decided. */
export interface PrePushVerdict {
  /** 1 blocks the push; 3 means a scanner could not finish (allowed, with a warning); 0 is clean. */
  exitCode: 0 | 1 | 3;
  /** Security findings that block the push. */
  blocking: AuditIssue[];
  /** Findings that do not block (hygiene, warnings, informational). */
  otherCount: number;
}

function isSecurityBlocker(result: AuditResult, issue: AuditIssue): boolean {
  if (!isBlockingSeverity(issue)) return false;
  return result.module === "scan" || SECURITY_CONFIG_CODES.has(issue.code);
}

/**
 * Decide whether the pre-push audit blocks the push.
 * Blocking findings are critical/error findings from the scan layer (OSV, Docker, env validation)
 * and leaked secrets found by config-guard; other config hygiene never blocks a push.
 * Findings win over a scanner failure: a push with known blocking findings is never waved through.
 *
 * @param results - Results of the audit checks
 * @returns The verdict
 */
export function prePushVerdict(results: readonly AuditResult[]): PrePushVerdict {
  const blocking = results.flatMap((result) => result.issues.filter((issue) => isSecurityBlocker(result, issue)));
  const total = results.reduce((sum, result) => sum + result.issues.length, 0);
  const scannerFailed = results.some((result) => result.scan?.exitCode === 3);
  const exitCode = blocking.length > 0 ? 1 : scannerFailed ? 3 : 0;
  return { exitCode, blocking, otherCount: total - blocking.length };
}

/**
 * Format the pre-push verdict.
 *
 * @param verdict - Result of {@link prePushVerdict}
 * @returns Lines to print (empty when there is nothing to say)
 */
export function renderPrePushReport(verdict: PrePushVerdict): string[] {
  const lines: string[] = [];
  if (verdict.blocking.length > 0) {
    lines.push(`muraqib: push blocked, ${verdict.blocking.length} security finding(s):`);
    for (const issue of verdict.blocking) {
      const where = issue.location?.file === undefined ? "" : ` (${issue.location.file}${issue.location.line === undefined ? "" : `:${issue.location.line}`})`;
      lines.push(`  ✖ [${issue.module ?? "audit"}] ${issue.title}${where}: ${issue.message}`);
    }
    lines.push("Fix them, or bypass once with `git push --no-verify`.");
  } else if (verdict.exitCode === 3) {
    lines.push("muraqib: a scanner could not complete (offline?), so the security audit is incomplete. Allowing the push.");
  }
  if (verdict.otherCount > 0) lines.push(`muraqib: ${verdict.otherCount} other finding(s) do not block the push; run \`muraqib audit\` for the full report.`);
  return lines;
}

/**
 * Pre-push: run the heavier security audit (secrets in env files plus the scan layer).
 * Blocks on security findings (exit 1); if a scanner could not finish (for example offline) and
 * nothing else blocks, it warns and allows the push.
 *
 * @param cwd - Directory git ran the hook in
 * @param env - Environment (`MURAQIB_SKIP_HOOKS` skips the audit)
 * @param io - Output sink
 * @param audit - Audit runner (defaults to the real audit)
 * @returns 1 to block the push, otherwise 0
 */
export async function runPrePush(
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
  io: HookIo = consoleIo,
  audit: PrePushAudit = defaultPrePushAudit
): Promise<number> {
  if (env[SKIP_ENV]) return 0;
  const gitRoot = findGitRoot(cwd);
  if (gitRoot === undefined) {
    io.err("muraqib: not inside a git repository, skipping the pre-push audit");
    return 0;
  }
  try {
    const verdict = prePushVerdict(await audit(gitRoot));
    for (const line of renderPrePushReport(verdict)) io.err(line);
    return verdict.exitCode === 1 ? 1 : 0;
  } catch (error) {
    io.err(`muraqib: the pre-push audit failed to run (${error instanceof Error ? error.message : String(error)}), allowing the push`);
    return 0;
  }
}
