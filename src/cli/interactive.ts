/**
 * Interactive (Clack) presentation for the audit command.
 *
 * Kept separate from the audit logic so the report itself stays pure and
 * machine-readable; this module only renders
 * the prompts, spinner and summary (the policy lives in interactive-policy.ts).
 */
import * as x from "@clack/prompts";
import type { AuditReport } from "./types.js";

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
