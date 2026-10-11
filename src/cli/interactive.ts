/**
 * Interactive (Clack) presentation for the audit command.
 *
 * Kept separate from the audit logic so the report itself stays pure and
 * machine-readable; this module only renders
 * the prompts, spinner and summary (the policy lives in interactive-policy.ts).
 */
import * as x from "@clack/prompts";
import type { AuditReport } from "./types.js";
import { AUDIT_CATEGORIES, resolveCategoryModules, type AuditCategoryId } from "./interactive-policy.js";
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

export type AfterReportAction = "html" | "all" | "done";

/** Offer follow-ups once the report is shown. Returns "done" on cancel. */
export async function promptAfterReport(hasIssues: boolean): Promise<AfterReportAction> {
  const options: { value: AfterReportAction; label: string; hint?: string }[] = [];
  if (hasIssues) options.push({ value: "all", label: "Show every issue", hint: "no truncation" });
  options.push({ value: "html", label: "Save an HTML report", hint: "muraqib-report.html" });
  options.push({ value: "done", label: "Finish" });
  const choice = await x.select<AfterReportAction>({ message: "What next?", options });
  return x.isCancel(choice) ? "done" : choice;
}

/** One-line verdict for the closing message. */
export function summarizeReport(report: AuditReport): { failed: boolean; text: string } {
  const { critical, high, medium, low, total } = report.summary;
  const text = `${total} issue(s): ${critical} critical, ${high} error, ${medium} warning, ${low} info`;
  return { failed: critical > 0 || high > 0, text };
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
