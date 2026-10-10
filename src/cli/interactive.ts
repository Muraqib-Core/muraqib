/**
 * Interactive (Clack) presentation for the audit command.
 *
 * Kept separate from the audit logic so the report itself stays pure and
 * machine-readable; this module only decides *whether* to be interactive and
 * renders the prompts, spinner and summary.
 */
import * as x from "@clack/prompts";
import type { AuditReport } from "./types.js";

export interface InteractiveContext {
  /** `-i/--interactive` (true), `--no-interactive` (false) or unset. */
  flag: boolean | undefined;
  format: string;
  hasOutputFile: boolean;
  stdoutIsTTY: boolean;
  stdinIsTTY: boolean;
  env: Record<string, string | undefined>;
}

export interface ScanChoices {
  osv: boolean;
  docker: boolean;
  aiAdvisory: boolean;
}

/**
 * Decide whether the audit should run with the Clack UI.
 * Never interactive for machine output (json/csv/html, --output) or CI.
 */
export function shouldUseInteractive(ctx: InteractiveContext): boolean {
  if (ctx.flag === false) return false;
  if (ctx.format !== "text" || ctx.hasOutputFile) return false;
  if (!ctx.stdoutIsTTY || !ctx.stdinIsTTY) return false;
  if (ctx.env["CI"] !== undefined && ctx.env["CI"] !== "" && ctx.env["CI"] !== "false") return false;
  return true;
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
