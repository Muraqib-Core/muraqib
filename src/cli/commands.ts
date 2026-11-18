/**
 * CLI command runners: audit (plain and guided), agent, scan-layer delegation.
 */
import { writeFileSync } from "fs";
import { resolve } from "path";
import type { CliOptions, AuditReport } from "./types.js";
import { formatReport } from "./formatters.js";
import { runAuditForAgent } from "../agent/run-audit-for-agent.js";
import { getSystemContext } from "../agent/system-context.js";
import { AGENT_TOOL_DEFINITIONS } from "../agent/tool-definitions.js";
import { shouldUseInteractive } from "./interactive-policy.js";
import type { ExtendedCliOptions } from "./args.js";
import { createAuditReport } from "./audit-report.js";

export type InteractiveUi = typeof import("./interactive.js");

/** Loads the guided UI on demand (injected by the entry point so importing the library never pulls in @clack/prompts). */
export type InteractiveUiLoader = () => Promise<InteractiveUi>;

/** Runs the scan layer's CLI (resolve / image / runtime) and returns the exit code it set. */
export async function runScanLayer(scanArgs: string[]): Promise<number> {
  const { main: runScanCli } = await import("../scan/cli.js");
  process.exitCode = undefined;
  await runScanCli(scanArgs);
  return typeof process.exitCode === "number" ? process.exitCode : 0;
}

/** Runs the agent command: a deterministic JSON report, printed or written to `--output`. */
async function runAgentCommand(options: ExtendedCliOptions): Promise<number> {
  const report = await runAuditForAgent({
    projectRoot: options.projectRoot,
    modules: options.modules,
    securityUrl: options.securityUrl,
    osv: options.osv,
    docker: options.docker,
    aiAdvisory: options.aiAdvisory,
    failOnWarning: options.failOnWarning,
    maxIssues: options.maxIssues,
  });
  const json = JSON.stringify(report, null, 2);
  if (options.output) writeFileSync(resolve(process.cwd(), options.output), json);
  else console.log(json);
  return report.exitCode ?? (report.verdict === "fail" ? 1 : 0);
}

/**
 * Asks the user what to audit. Returns false when they cancelled (the cancellation is already shown).
 * Only called in guided mode (`--interactive`).
 */
async function promptAuditChoices(ui: InteractiveUi, options: ExtendedCliOptions): Promise<boolean> {
  if (!options.modules) {
    const picked = await ui.promptCategories();
    if (!picked) {
      ui.showCancelled();
      return false;
    }
    if (picked.modules) options.modules = picked.modules;
    if (!options.securityUrl && picked.modules?.includes("security-guard")) {
      const url = await ui.promptSecurityUrl();
      if (url === null) {
        ui.showCancelled();
        return false;
      }
      options.securityUrl = url;
    }
  }
  if (!options.osv && !options.docker && !options.aiAdvisory) {
    const choices = await ui.promptScanChoices();
    if (!choices) {
      ui.showCancelled();
      return false;
    }
    options.osv = choices.osv;
    options.docker = choices.docker;
    options.aiAdvisory = choices.aiAdvisory;
  }
  return true;
}

/** Performs one follow-up the user picked after the report was shown. */
function performFollowUp(ui: InteractiveUi, report: AuditReport, action: string): void {
  if (action === "all") console.log(formatReport(report, "text"));
  else if (action === "fixes") ui.showFixes(report);
  else if (action === "ai") ui.showAssistantPrompt(report);
  else if (action === "html") {
    const htmlPath = resolve(process.cwd(), "muraqib-report.html");
    writeFileSync(htmlPath, formatReport(report, "html"));
    console.log(`Report saved to ${htmlPath}`);
  }
}

/** Keeps offering follow-ups until the user finishes (or cancels, which reads as "done"). */
async function offerFollowUps(ui: InteractiveUi, report: AuditReport): Promise<void> {
  const hasIssues = report.summary.total > 0;
  for (let action = await ui.promptAfterReport(hasIssues); action !== "done"; action = await ui.promptAfterReport(hasIssues)) {
    performFollowUp(ui, report, action);
  }
}

/** Exit code of a finished audit: the report's own code, else derived from the summary. */
function exitCodeFor(report: AuditReport, failOnWarning: boolean | undefined): number {
  if (report.exitCode !== undefined) return report.exitCode;
  const { summary } = report;
  if (summary.critical > 0 || summary.error > 0) return 1;
  if (failOnWarning && summary.warning > 0) return 1;
  return 0;
}

/** Loads the guided UI when this run should be interactive; explains why when `--interactive` was refused. */
async function loadInteractiveUi(options: ExtendedCliOptions, load: InteractiveUiLoader): Promise<InteractiveUi | null> {
  const interactive = shouldUseInteractive({
    flag: options.interactive,
    format: options.format ?? "text",
    hasOutputFile: Boolean(options.output),
    stdoutIsTTY: Boolean(process.stdout.isTTY),
    stdinIsTTY: Boolean(process.stdin.isTTY),
    env: process.env,
  });
  const ui = interactive ? await load() : null;
  if (options.interactive === true && !ui) {
    console.error("ℹ️  Interactive mode needs a terminal and text output (not CI, pipes, --json/--format or --output); continuing non-interactively.");
  }
  return ui;
}

/** Writes the formatted report to `--output`, or prints it; the guided UI shows it itself when there is no file. */
async function deliverReport(
  ui: InteractiveUi | null,
  options: ExtendedCliOptions,
  report: AuditReport,
  formatted: string
): Promise<void> {
  if (ui && !options.output) {
    ui.showReport(report, options.verbose);
    if (options.interactive === true) await offerFollowUps(ui, report);
  } else if (options.output) {
    const outputPath = resolve(process.cwd(), options.output);
    writeFileSync(outputPath, formatted);
    if (options.verbose) {
      console.log(`✅ Report saved to: ${outputPath}`);
    }
  } else {
    console.log(formatted);
  }
}

/** Runs the default audit command: optional guided prompts, the audit itself and report output. */
async function runAuditCommand(options: ExtendedCliOptions, load: InteractiveUiLoader): Promise<number> {
  const ui = await loadInteractiveUi(options, load);
  if (ui) {
    ui.showIntro(options.projectRoot ?? process.cwd());
    if (options.interactive === true && !(await promptAuditChoices(ui, options))) return 130;
  }

  const auditOptions = {
    ...(options as CliOptions & { securityUrl?: string }),
    scan: Boolean(options.osv || options.docker || options.aiAdvisory || options.env || options.engine),
    aiAdvisory: options.aiAdvisory ?? false,
    dockerNative: options.dockerNative ?? false,
  };

  if (options.verbose) {
    console.log("🚀 Starting Muraqib Core audit...");
    console.log(`📁 Project root: ${auditOptions.projectRoot}`);
    console.log(`📊 Format: ${auditOptions.format}`);
  }

  const report = ui
    ? await ui.withSpinner("Running audit modules...", () => createAuditReport(auditOptions))
    : await createAuditReport(auditOptions);

  await deliverReport(ui, options, report, formatReport(report, auditOptions.format));

  if (ui) ui.showOutro(report);
  if (options.verbose) {
    console.log("✅ Audit completed successfully");
  }

  return exitCodeFor(report, auditOptions.failOnWarning);
}

/** Runs a parsed command whose project root has already been resolved. */
export async function runCommand(
  command: NonNullable<ExtendedCliOptions["command"]>,
  options: ExtendedCliOptions,
  load: InteractiveUiLoader
): Promise<number> {
  switch (command) {
    case "context":
      console.log(JSON.stringify(getSystemContext(), null, 2));
      return 0;
    case "tool-schema":
      console.log(JSON.stringify(AGENT_TOOL_DEFINITIONS, null, 2));
      return 0;
    case "agent":
      return runAgentCommand(options);
    case "resolve":
      // `muraqib -p <dir> resolve ...` : run the real resolution workflow in the target project
      if (options.projectRoot) process.chdir(options.projectRoot);
      return runScanLayer(["resolve"]);
    case "audit":
    default:
      return runAuditCommand(options, load);
  }
}
