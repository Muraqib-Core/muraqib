/**
 * Muraqib CLI - Command Line Interface
 * Main entry point for running audits from the command line
 */
import { pathToFileURL } from "url";
import { parseArgs, resolveProjectRoot } from "./args.js";
import { runCommand, runScanLayer } from "./commands.js";
import type { InteractiveUi } from "./commands.js";

export { formatReport } from "./formatters.js";
export { createAuditReport } from "./audit-report.js";
export type { CliOptions, AuditReport, OutputFormat } from "./types.js";

// Loaded on demand so importing the library never pulls in @clack/prompts
const loadInteractiveUi = (): Promise<InteractiveUi> => import("./interactive.js");

const SCAN_COMMANDS = new Set(["resolve", "image", "runtime"]);

// Flags belonging to the 13-module workflow (--skip-*, --url, --upgrade, ...)
const WORKFLOW_FLAGS = new Set(["--url", "--path", "--upgrade", "--safe", "--presets", "--schedule", "--silent"]);
function usesWorkflowFlags(args: string[]): boolean {
  return args.some((a) => a.startsWith("--skip-") || WORKFLOW_FLAGS.has(a));
}

/**
 * Run cli.
 *
 * @param args - Args
 * @returns Run cli result
 */
export async function runCli(args: string[]): Promise<number> {
  try {
    // resolve / image / runtime are served by the scan layer (dependency resolution, Trivy image, runtime inspection)
    if (args[0] && SCAN_COMMANDS.has(args[0])) return await runScanLayer(args);

    // hook install / uninstall / run manage the git hooks (loaded on demand so hooks start fast)
    if (args[0] === "hook") return await (await import("../hooks/cli.js")).runHookCli(args.slice(1));

    // Workflow-style audit (13 modules, --skip-*, --url, --upgrade ...) is served by the workflow runner
    if (usesWorkflowFlags(args) && !args.some((a) => SCAN_COMMANDS.has(a))) {
      const { run: runWorkflowCli } = await import("./audit-cli.js");
      await runWorkflowCli();
      return typeof process.exitCode === "number" ? process.exitCode : 0;
    }

    const options = parseArgs(args);
    const command = options.command ?? "audit";

    if (command !== "context" && command !== "tool-schema") {
      options.projectRoot = resolveProjectRoot(options.projectRoot ?? process.cwd());
    }
    return await runCommand(command, options, loadInteractiveUi);
  } catch (error) {
    console.error(
      "❌ Error:",
      error instanceof Error ? error.message : String(error)
    );
    return 1;
  }
}

// CLI entry point
const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const args = process.argv.slice(2);
  runCli(args)
    .then((code) => {
      // Set exitCode instead of calling process.exit() so large stdout payloads
      // are fully flushed when piped (process.exit truncates at the 64KB pipe buffer).
      process.exitCode = code;
    })
    .catch((error) => {
      console.error("Fatal error:", error);
      process.exitCode = 1;
    });
}
