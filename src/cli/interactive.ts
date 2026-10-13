import { scanCoverageLines } from "./scan-coverage.js";
/**
 * Interactive (Clack) presentation for the audit command.
 *
 * Kept separate from the audit logic so the report itself stays pure and
 * machine-readable; this module only renders
 * the prompts, spinner and summary (the policy lives in interactive-policy.ts).
 */
import * as x from "@clack/prompts";
import chalk from "chalk";
import type { AuditReport } from "./types.js";
import { AUDIT_CATEGORIES, resolveCategoryModules, type AuditCategoryId } from "./interactive-policy.js";
import { buildAssistantPrompt, collectIssues, groupFixes, type SeverityName } from "./interactive-actions.js";
import { buildNextSteps, getModuleViews, renderModuleIssues, renderOverview } from "./interactive-report.js";

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

/**
 * Ask what to audit. Returns the module filter (undefined = everything) or null when cancelled.
 * "Full audit" is preselected so pressing enter runs everything.
 */
export async function promptCategories(): Promise<{ modules: string[] | undefined; ids: AuditCategoryId[] } | null> {
  const picked = await x.multiselect<AuditCategoryId>({
    message: "What should Muraqib check? (space to toggle, enter to confirm)",
    required: true,
    initialValues: ["full"],
    options: AUDIT_CATEGORIES.map((c) => ({ value: c.id, label: c.label, hint: c.hint })),
  });
  if (x.isCancel(picked)) return null;
  return { modules: resolveCategoryModules(picked), ids: picked };
}

/** Ask for the running site URL used by the security headers check. Blank skips it; null when cancelled. */
export async function promptSecurityUrl(): Promise<string | undefined | null> {
  const value = await x.text({
    message: "Running site URL for the security-headers check (leave blank to skip)",
    placeholder: "http://localhost:3000",
    validate: (v) => (v && !/^https?:\/\//.test(v) ? "Enter a URL starting with http:// or https://" : undefined),
  });
  if (x.isCancel(value)) return null;
  return value ? value : undefined;
}

/** Print the colour-coded report: overview, per-module issues, then next steps. */
export function showReport(report: AuditReport, verbose = false): void {
  const views = getModuleViews(report);
  x.note(renderOverview(views), "Results");
  const coverage = scanCoverageLines(report);
  if (coverage.length) x.note(coverage.join("\n"), "Scanner Coverage");
  for (const view of views.filter((v) => v.issues.length > 0)) {
    x.log.message(`${view.name}\n${renderModuleIssues(view, verbose ? Number.POSITIVE_INFINITY : 5)}`);
  }
  const steps = buildNextSteps(report);
  if (steps.length === 0) return;
  const body = steps
    .map((s, i) => `${i + 1}. ${s.title}\n   ${s.detail}${s.command ? `\n   $ ${s.command}` : ""}`)
    .join("\n");
  x.note(body, "Next steps");
}

/** The de-duplicated fix list for the whole report, most severe first. */
export function showFixes(report: AuditReport): void {
  const fixes = groupFixes(collectIssues(report));
  if (fixes.length === 0) {
    x.log.info("No automatic recommendations were provided for these issues.");
    return;
  }
  const tone: Record<SeverityName, (s: string) => string> = {
    critical: (s) => chalk.red.bold(s),
    error: (s) => chalk.red(s),
    warning: (s) => chalk.yellow(s),
    info: (s) => chalk.cyan(s),
  };
  const body = fixes
    .map((fix, n) => {
      const times = fix.count > 1 ? chalk.dim(` ×${fix.count}`) : "";
      return `${n + 1}. ${tone[fix.severity](`[${fix.severity}]`)} ${fix.recommendation}${times} ${chalk.dim(`(${fix.modules.join(", ")})`)}`;
    })
    .join("\n");
  x.note(body, "Recommended fixes");
}

/** A paste-ready prompt for an AI assistant (Claude, ChatGPT, an IDE agent) to fix the findings. */
export function showAssistantPrompt(report: AuditReport): void {
  x.note(buildAssistantPrompt(report), "Paste this into your AI assistant");
}

export type AfterReportAction = "fixes" | "ai" | "html" | "all" | "done";

/** Offer follow-ups once the report is shown. Returns "done" on cancel. */
export async function promptAfterReport(hasIssues: boolean): Promise<AfterReportAction> {
  const options: { value: AfterReportAction; label: string; hint?: string }[] = [];
  if (hasIssues) options.push({ value: "fixes", label: "Show recommended fixes", hint: "grouped, most severe first" });
  if (hasIssues) options.push({ value: "all", label: "Show every issue", hint: "no truncation" });
  if (hasIssues) options.push({ value: "ai", label: "Hand off to an AI assistant", hint: "paste-ready prompt" });
  options.push({ value: "html", label: "Save an HTML report", hint: "muraqib-report.html" });
  options.push({ value: "done", label: "Finish" });
  const choice = await x.select<AfterReportAction>({ message: "What next?", options });
  return x.isCancel(choice) ? "done" : choice;
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
  if (report.exitCode === 3) {
    x.outro(chalk.red("A scanner failed; the audit could not complete reliably."));
    return;
  }
  if (report.exitCode === 1 && report.summary.critical + report.summary.error === 0) {
    x.outro(chalk.yellow("Findings block the selected audit policy. Review the report and re-run."));
    return;
  }
  const { failed, text } = summarizeReport(report);
  if (failed) x.outro(`Failed — ${text}`);
  else x.outro(`Passed — ${text}`);
}

export function showCancelled(): void {
  x.cancel("Audit cancelled");
}
