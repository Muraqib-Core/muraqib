/**
 * Bridge between the scan layer (Jenan's Finding model / AuditRunner) and the guard layer
 * (Aya's AuditIssue / AuditResult), so both feed one unified report.
 */
import type { AuditIssue, AuditResult } from "../core/types.js";
import semver from "semver";
import type { DependencyProblemData, Finding, OsvAdvisoryData } from "./core/findings/finding.js";
import { createProjectContext } from "./core/context/project-context.js";
import { AuditRunner, type AuditReport as ScanReport } from "./core/runner/audit-runner.js";

const SEVERITY_MAP: Record<Finding["severity"], AuditIssue["severity"]> = {
  critical: "critical",
  high: "error",
  medium: "warning",
  low: "info",
  info: "info",
};

const MAX_LISTED_ADVISORIES = 3;

/**
 * The lowest version that fixes one advisory for the installed version: the `fixed` event of the
 * range containing it. Ranges that do not contain the installed version (other major lines) are ignored.
 */
function fixedVersionFor(advisory: OsvAdvisoryData, installed: string): string | undefined {
  let best: string | undefined;
  for (const range of advisory.ranges ?? []) {
    let introduced = "0";
    for (const event of range.events ?? []) {
      if (event.introduced !== undefined) introduced = event.introduced;
      if (event.fixed === undefined || !semver.valid(event.fixed)) continue;
      if (introduced !== "0" && !semver.valid(introduced)) continue;
      const inRange = (introduced === "0" || semver.gte(installed, introduced)) && semver.lt(installed, event.fixed);
      if (inRange && (best === undefined || semver.lt(event.fixed, best))) best = event.fixed;
    }
  }
  return best;
}

/** Highest fix across all advisories = the lowest version that resolves every one of them. */
function upgradeTarget(problem: DependencyProblemData): string | undefined {
  if (!semver.valid(problem.installedVersion)) return problem.fixedVersions[problem.fixedVersions.length - 1];
  let target: string | undefined;
  for (const advisory of problem.advisories) {
    const fixed = fixedVersionFor(advisory, problem.installedVersion);
    if (fixed !== undefined && semver.valid(fixed) && (target === undefined || semver.gt(fixed, target))) target = fixed;
  }
  return target;
}

/** Summarise OSV advisories as "ids (+N more)" and the upgrade target. */
function describeDependencyProblem(problem: DependencyProblemData): { ids: string; upgrade?: string } {
  const ids = problem.advisories.map((a) => a.id);
  const shown = ids.slice(0, MAX_LISTED_ADVISORIES).join(", ");
  const extra = ids.length - MAX_LISTED_ADVISORIES;
  const description: { ids: string; upgrade?: string } = { ids: extra > 0 ? `${shown} (+${extra} more)` : shown };
  const target = upgradeTarget(problem);
  if (target) description.upgrade = `Upgrade ${problem.package} to >= ${target}`;
  return description;
}

export function findingToAuditIssue(f: Finding): AuditIssue {
  let message = f.message;
  let recommendation = f.remediation;
  if (f.dependencyProblem) {
    const { ids, upgrade } = describeDependencyProblem(f.dependencyProblem);
    if (ids) message = `${message} Advisories: ${ids}.`;
    recommendation = recommendation ?? upgrade;
  }
  const issue: AuditIssue = {
    code: f.id,
    severity: SEVERITY_MAP[f.severity],
    title: f.title,
    message,
    tags: [f.source, f.category, ...(f.confidence ? [f.confidence] : [])],
  };
  if (recommendation) issue.recommendation = recommendation;
  if (f.confidence) issue.confidence = f.confidence;
  if (f.evidence) issue.evidence = f.evidence;
  if (f.key) issue.key = f.key;
  if (f.dependencyProblem) issue.dependencyProblem = f.dependencyProblem;
  if (f.imageProblem) issue.imageProblem = f.imageProblem;
  if (f.file) {
    issue.location = { file: f.file, ...(f.line !== undefined ? { line: f.line } : {}) };
  }
  return issue;
}

export interface ScanAuditOptions {
  enableAi?: boolean;
  dockerNative?: boolean;
  mode?: "build" | "prod";
}

export interface ScanAuditOutcome {
  result: AuditResult;
  report: ScanReport;
}

/** Run Jenan's AuditRunner (env files, OSV, compatibility, Docker, optional AI) and map to an AuditResult. */
export async function runScanAudit(projectRoot: string, options: ScanAuditOptions = {}): Promise<ScanAuditOutcome> {
  const started = Date.now();
  const context = createProjectContext(projectRoot);
  const report = await new AuditRunner().run(context, {
    mode: options.mode ?? "build",
    enableAi: options.enableAi ?? false,
    dockerNative: options.dockerNative ?? false,
  });
  const issues = report.findings.map(findingToAuditIssue);
  const failed = report.exitCode === 3;
  const result: AuditResult = {
    status: failed ? "error" : issues.length === 0 ? "ok" : issues.some((i) => i.severity === "critical" || i.severity === "error") ? "issues" : "warning",
    module: "scan",
    issues,
    message: failed
      ? "Scan layer could not complete reliably"
      : `Scan layer: ${issues.length} finding(s) across ${report.scannerCoverage.length} scanner(s)`,
    timestamp: Date.now(),
    duration: Date.now() - started,
  };
  return { result, report };
}
