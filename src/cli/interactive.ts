/**
 * Interactive (Clack) presentation for the audit command.
 *
 * Kept separate from the audit logic so the report itself stays pure and
 * machine-readable; this module only renders
 * the prompts, spinner and summary (the policy lives in interactive-policy.ts).
 */
import * as x from "@clack/prompts";
import chalk from "chalk";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { formatReport } from "./formatters.js";
import {
  AUDIT_SCOPES,
  MODULE_CHOICES,
  buildAssistantPrompt,
  collectIssues,
  formatLocation,
  groupFixes,
  includesSecurity,
  moduleStatuses,
  type FlatIssue,
  type SeverityName,
} from "./interactive-model.js";
import type { AuditReport, OutputFormat } from "./types.js";

export { shouldUseInteractive } from "./interactive-policy.js";
export type { InteractiveContext } from "./interactive-policy.js";

export interface ScanChoices {
  osv: boolean;
  docker: boolean;
  aiAdvisory: boolean;
}

/** Ask which optional scan layers to enable. Returns null when cancelled. */
export async function promptScanChoices(): Promise<ScanChoices | null> {
  const picked = await x.multiselect<"osv" | "docker" | "ai">({
    message: "Optional scans to include (space to toggle, enter to confirm)",
    required: false,
    options: [
      { value: "osv", label: "OSV vulnerability scan", hint: "dependencies" },
      { value: "docker", label: "Docker discovery", hint: "Dockerfile / compose" },
      { value: "ai", label: "AI advisory", hint: "needs an API key" },
    ],
  });
  if (x.isCancel(picked)) return null;
  return { osv: picked.includes("osv"), docker: picked.includes("docker"), aiAdvisory: picked.includes("ai") };
}

/** One-line verdict for the closing message. */
export function summarizeReport(report: AuditReport): { failed: boolean; text: string } {
  const { critical, error, warning, info, total } = report.summary;
  const text = `${total} issue(s): ${critical} critical, ${error} error, ${warning} warning, ${info} info`;
  return { failed: critical > 0 || error > 0, text };
}

/** Run `task` behind a spinner; the spinner is always stopped. */
export async function withSpinner<T>(label: string, task: () => Promise<T>): Promise<T> {
  const spinner = x.spinner();
  spinner.start(label);
  try {
    const value = await task();
    spinner.stop("Audit finished");
    return value;
  } catch (error) {
    spinner.error("Audit failed");
    throw error;
  }
}

export function showIntro(projectRoot: string): void {
  x.intro("Muraqib audit");
  x.log.info(`Project: ${projectRoot}`);
}

export function showOutro(report: AuditReport): void {
  const { failed, text } = summarizeReport(report);
  if (failed) x.outro(`Failed — ${text}`);
  else x.outro(`Passed — ${text}`);
}

export function showCancelled(): void {
  x.cancel("Audit cancelled");
}

// ---------------------------------------------------------------------------
// Interactive session: scope -> optional scans -> run -> results -> next steps
// ---------------------------------------------------------------------------

const paint: Record<SeverityName, (text: string) => string> = {
  critical: (t) => chalk.red.bold(t),
  error: (t) => chalk.red(t),
  warning: (t) => chalk.yellow(t),
  info: (t) => chalk.cyan(t),
};

/** Ask what to audit. Returns the `--modules` filters (empty = everything) or null when cancelled. */
export async function promptAuditScope(): Promise<string[] | null> {
  const scope = await x.select<(typeof AUDIT_SCOPES)[number]["id"]>({
    message: "What would you like to audit?",
    options: AUDIT_SCOPES.map((s) => ({ value: s.id, label: s.label, hint: s.hint })),
    initialValue: "full",
  });
  if (x.isCancel(scope)) return null;
  if (scope !== "custom") return [...(AUDIT_SCOPES.find((s) => s.id === scope)?.modules ?? [])];

  const picked = await x.multiselect<string>({
    message: "Modules to run (space to toggle, enter to confirm)",
    required: true,
    options: MODULE_CHOICES.map((m) => ({ value: m.value, label: m.label, hint: m.hint })),
  });
  return x.isCancel(picked) ? null : picked;
}

/** Optional running-service URL for the HTTP security checks. `undefined` = skipped, null = cancelled. */
export async function promptSecurityUrl(): Promise<string | undefined | null> {
  const answer = await x.text({
    message: "URL of a running service for HTTP security-header checks (optional)",
    placeholder: "http://localhost:3000 - leave empty to skip",
    validate: (value) => {
      const text = (value ?? "").trim();
      if (text === "") return undefined;
      return /^https?:\/\/\S+$/i.test(text) ? undefined : "Enter an http:// or https:// URL, or leave empty";
    },
  });
  if (x.isCancel(answer)) return null;
  const url = String(answer ?? "").trim();
  return url === "" ? undefined : url;
}

function moduleLine(name: string, count: number, worst: SeverityName | null): string {
  if (worst === null) return `${chalk.green("✔")} ${name}`;
  return `${paint[worst]("✖")} ${name} ${chalk.dim(`- ${count} issue${count === 1 ? "" : "s"}, worst: ${worst}`)}`;
}

/** Colour-coded verdict, severity counts and per-module status. */
export function showReport(report: AuditReport): void {
  const { critical, error, warning, info, total } = report.summary;
  const { failed } = summarizeReport(report);
  const count = (n: number, severity: SeverityName): string =>
    n === 0 ? chalk.dim(`0 ${severity}`) : paint[severity](`${n} ${severity}`);
  const lines = [
    failed ? chalk.red.bold("✖ FAILED - fix critical/error issues before shipping") : chalk.green.bold("✔ PASSED - no blocking issues"),
    "",
    `${count(critical, "critical")}   ${count(error, "error")}   ${count(warning, "warning")}   ${count(info, "info")}   ${chalk.dim(`(${total} total)`)}`,
    "",
    ...moduleStatuses(report).map((m) => moduleLine(m.name, m.count, m.worst)),
  ];
  x.note(lines.join("\n"), "Results");
}

function logIssue(issue: FlatIssue): void {
  // Titles such as "Configuration Issue: .eslintignore" already name the file; don't repeat it.
  const where = issue.line === undefined && issue.file !== undefined && issue.title.includes(issue.file) ? "" : formatLocation(issue);
  const body = [
    `${paint[issue.severity](`[${issue.severity}]`)} ${chalk.bold(issue.title)}${where ? chalk.dim(` ${where}`) : ""}`,
    issue.message,
    ...(issue.recommendation ? [chalk.green(`→ ${issue.recommendation}`)] : []),
  ].join("\n");
  if (issue.severity === "critical" || issue.severity === "error") x.log.error(body);
  else if (issue.severity === "warning") x.log.warn(body);
  else x.log.info(body);
}

/** List issues (most severe first); `limit` caps the output and says how many were left out. */
export function showIssues(issues: readonly FlatIssue[], limit = Number.POSITIVE_INFINITY): void {
  for (const issue of issues.slice(0, limit)) logIssue(issue);
  if (issues.length > limit) x.log.message(chalk.dim(`… and ${issues.length - limit} more - choose "Show all issues" below`));
}

/** The de-duplicated fix list, most severe first. */
export function showFixes(issues: readonly FlatIssue[]): void {
  const fixes = groupFixes(issues);
  if (fixes.length === 0) {
    x.log.info("No automatic recommendations were provided for these issues.");
    return;
  }
  const lines = fixes.map((fix, n) => {
    const times = fix.count > 1 ? chalk.dim(` ×${fix.count}`) : "";
    return `${chalk.bold(`${n + 1}.`)} ${paint[fix.severity](`[${fix.severity}]`)} ${fix.recommendation}${times} ${chalk.dim(`(${fix.modules.join(", ")})`)}`;
  });
  x.note(lines.join("\n"), "Recommended fixes");
}

export type NextStep = "details" | "fixes" | "ai" | "save" | "rerun" | "done";

/**
 * @param blocking - the run failed (critical/error present); only changes the wording.
 * @param hiddenIssues - issues not yet on screen; "Show all issues" is offered only when > 0.
 */
export async function promptNextStep(blocking: boolean, hiddenIssues = 1): Promise<NextStep | null> {
  const step = await x.select<NextStep>({
    message: blocking ? "Issues found - what next?" : "Anything else?",
    options: [
      { value: "fixes", label: "Show recommended fixes", hint: "grouped, most severe first" },
      ...(hiddenIssues > 0
        ? [{ value: "details" as const, label: "Show all issues", hint: `${hiddenIssues} more, with file and line` }]
        : []),
      { value: "ai", label: "Hand off to an AI assistant", hint: "paste-ready prompt" },
      { value: "save", label: "Save the report", hint: "html, json, csv or text" },
      { value: "rerun", label: "Run another audit", hint: "pick a different scope" },
      { value: "done", label: "Done" },
    ],
    initialValue: "fixes",
  });
  return x.isCancel(step) ? null : step;
}

const EXTENSIONS: Record<OutputFormat, string> = { html: "html", json: "json", csv: "csv", text: "txt" };

/** Ask for a format and path, then write the report. Returns the path, or null if cancelled. */
export async function promptSaveReport(report: AuditReport): Promise<string | null> {
  const format = await x.select<OutputFormat>({
    message: "Report format",
    options: [
      { value: "html", label: "HTML", hint: "shareable page" },
      { value: "json", label: "JSON", hint: "machine-readable" },
      { value: "csv", label: "CSV", hint: "spreadsheet summary" },
      { value: "text", label: "Text" },
    ],
    initialValue: "html",
  });
  if (x.isCancel(format)) return null;
  const target = await x.text({
    message: "Save to",
    initialValue: `muraqib-report.${EXTENSIONS[format]}`,
    validate: (value) => ((value ?? "").trim() === "" ? "Enter a file path" : undefined),
  });
  if (x.isCancel(target)) return null;
  const path = resolve(process.cwd(), String(target).trim());
  writeFileSync(path, formatReport(report, format));
  x.log.success(`Saved ${format.toUpperCase()} report to ${path}`);
  return path;
}

export interface InteractiveAuditOptions {
  projectRoot: string;
  /** Module filters; empty/undefined means the user is asked (first pass) or everything. */
  modules?: string[] | undefined;
  securityUrl?: string | undefined;
  osv?: boolean | undefined;
  docker?: boolean | undefined;
  aiAdvisory?: boolean | undefined;
}

export type SessionOutcome = { cancelled: true } | { cancelled: false; report: AuditReport };

const MAX_LISTED = 8;

/**
 * Drive the whole `-i` experience. `audit` performs the actual run (injected so this module
 * never imports the CLI entry point). Returns the final report, whose verdict decides the exit code.
 */
export async function runInteractiveSession(
  initial: InteractiveAuditOptions,
  audit: (options: InteractiveAuditOptions) => Promise<AuditReport>
): Promise<SessionOutcome> {
  const scanFlagsGiven = Boolean(initial.osv || initial.docker || initial.aiAdvisory);
  let askScope = initial.modules === undefined || initial.modules.length === 0;
  let securityUrl = initial.securityUrl;
  let securityAsked = securityUrl !== undefined;

  for (;;) {
    let modules = initial.modules ?? [];
    if (askScope) {
      const picked = await promptAuditScope();
      if (!picked) return { cancelled: true };
      modules = picked;
    }

    let scans = { osv: initial.osv ?? false, docker: initial.docker ?? false, aiAdvisory: initial.aiAdvisory ?? false };
    if (!scanFlagsGiven) {
      const choices = await promptScanChoices();
      if (!choices) return { cancelled: true };
      scans = choices;
    }

    if (!securityAsked && includesSecurity(modules)) {
      const url = await promptSecurityUrl();
      if (url === null) return { cancelled: true };
      securityUrl = url;
      securityAsked = true;
    }

    const options: InteractiveAuditOptions = { ...scans, projectRoot: initial.projectRoot, modules, securityUrl };
    const report = await withSpinner(modules.length ? `Running ${modules.join(", ")}...` : "Running all audit modules...", () => audit(options));

    showReport(report);
    const issues = collectIssues(report);
    const noisy = issues.filter((i) => i.severity !== "info");
    showIssues(noisy, MAX_LISTED);
    const hiddenIssues = issues.length - Math.min(noisy.length, MAX_LISTED);

    let rerun = false;
    if (issues.length > 0) {
      for (;;) {
        const step = await promptNextStep(summarizeReport(report).failed, hiddenIssues);
        if (step === null) return { cancelled: true };
        if (step === "done") break;
        if (step === "rerun") {
          rerun = true;
          askScope = true;
          break;
        }
        if (step === "details") showIssues(issues);
        else if (step === "fixes") showFixes(issues);
        else if (step === "ai") x.note(buildAssistantPrompt(report), "Paste this into your AI assistant");
        else if (step === "save" && (await promptSaveReport(report)) === null) return { cancelled: true };
      }
    }
    if (rerun) continue;

    showOutro(report);
    return { cancelled: false, report };
  }
}
