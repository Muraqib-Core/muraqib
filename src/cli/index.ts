/**
 * Muraqib CLI - Command Line Interface
 * Main entry point for running audits from the command line
 */
import { existsSync, readFileSync, statSync, writeFileSync } from "fs";
import { homedir } from "os";
import { resolve } from "path";
import type { CliOptions, AuditReport, OutputFormat } from "./types.js";
import { fileURLToPath, pathToFileURL } from "url";
import { formatReport } from "./formatters.js";
import { runAuditForAgent } from "../agent/run-audit-for-agent.js";
import { getSystemContext } from "../agent/system-context.js";
import { AGENT_TOOL_DEFINITIONS } from "../agent/tool-definitions.js";
import { auditExitCode } from "../core/audit-exit-code.js";
import { collectAuditResults } from "../orchestrator/collect-results.js";
import { shouldUseInteractive } from "./interactive-policy.js";
import type { ValidationEngineName } from "../scan/guard/core/engine-detector.js";
import { nonEmpty } from "../utils/defaults.js";

export { formatReport } from "./formatters.js";
export type { CliOptions, AuditReport, OutputFormat } from "./types.js";

interface ExtendedCliOptions extends Partial<CliOptions> {
  command?: "audit" | "resolve" | "agent" | "context" | "tool-schema";
  dockerNative?: boolean;
  maxIssues?: number;
  interactive?: boolean;
  osv?: boolean;
  docker?: boolean;
  aiAdvisory?: boolean;
  env?: "build" | "prod";
  engine?: ValidationEngineName;
  packageName?: string | undefined;
  packageVersion?: string | undefined;
  securityUrl?: string | undefined;
}

const VALIDATION_ENGINES: readonly ValidationEngineName[] = ["custom", "zod", "valibot", "arktype"];
function isValidationEngine(value: string | undefined): value is ValidationEngineName {
  return VALIDATION_ENGINES.some((engine) => engine === value);
}

/**
 * Expand a leading `~` (shells such as PowerShell/cmd leave it untouched) and make sure the
 * project root is an existing directory, so a typo fails fast instead of producing a bogus report.
 */
function resolveProjectRoot(raw: string): string {
  const expanded = raw === "~" || /^~[\\/]/.test(raw) ? resolve(homedir(), raw.slice(2)) : resolve(raw);
  if (!existsSync(expanded) || !statSync(expanded).isDirectory()) {
    throw new Error(`Project path not found or not a directory: ${expanded}`);
  }
  return expanded;
}

const COMMAND_WORDS: ReadonlyMap<string, NonNullable<ExtendedCliOptions["command"]>> = new Map([
  ["resolve", "resolve"],
  ["audit", "audit"],
  ["agent", "agent"],
  ["context", "context"],
  ["tool-schema", "tool-schema"],
]);

/** Applies a flag to `options`; `value` is the next argument. Returns how many extra arguments it consumed. */
type FlagHandler = (options: ExtendedCliOptions, value: string | undefined) => number;

/** A flag that takes no value. */
const switchFlag = (apply: (options: ExtendedCliOptions) => void): FlagHandler => (options) => {
  apply(options);
  return 0;
};

/** A flag that always consumes the next argument. */
const valueFlag = (apply: (options: ExtendedCliOptions, value: string | undefined) => void): FlagHandler =>
  (options, value) => {
    apply(options, value);
    return 1;
  };

/** Exits the process; typed as returning so callers keep parsing if `exit` is stubbed (as in tests). */
function exitProcess(code: number): void {
  process.exit(code);
}

function showHelp(options: ExtendedCliOptions): number {
  printHelp(options.command === "resolve" ? "resolve" : "audit");
  exitProcess(0);
  return 0;
}

/** `--version` means "package version" for `resolve` and "print the CLI version" for `audit`. */
function handleVersion(options: ExtendedCliOptions, value: string | undefined): number {
  if (options.command === "resolve") {
    options.packageVersion = value;
    return 1;
  }
  if (options.command === "audit") {
    console.log(`Muraqib Core v${readPackageVersion()}`);
    exitProcess(0);
  }
  return 0;
}

const FLAG_HANDLERS: ReadonlyMap<string, FlagHandler> = new Map<string, FlagHandler>([
  ["--json", switchFlag((o) => { o.format = "json"; })],
  ["--interactive", switchFlag((o) => { o.interactive = true; })],
  ["-i", switchFlag((o) => { o.interactive = true; })],
  ["--no-interactive", switchFlag((o) => { o.interactive = false; })],
  ["--docker-native", switchFlag((o) => { o.dockerNative = true; })],
  ["--verbose", switchFlag((o) => { o.verbose = true; })],
  ["-v", switchFlag((o) => { o.verbose = true; })],
  ["--fail-on-warning", switchFlag((o) => { o.failOnWarning = true; })],
  ["--osv", switchFlag((o) => { o.osv = true; })],
  ["--docker", switchFlag((o) => { o.docker = true; })],
  ["--ai-advisory", switchFlag((o) => { o.aiAdvisory = true; })],
  ["--max-issues", valueFlag((o, value) => {
    const n = Number.parseInt(value ?? "", 10);
    if (Number.isInteger(n) && n >= 0) o.maxIssues = n;
  })],
  ["--format", formatFlag],
  ["-f", formatFlag],
  ["--output", valueFlag((o, value) => { o.output = value; })],
  ["-o", valueFlag((o, value) => { o.output = value; })],
  ["--project", valueFlag((o, value) => { o.projectRoot = nonEmpty(value, process.cwd()); })],
  ["-p", valueFlag((o, value) => { o.projectRoot = nonEmpty(value, process.cwd()); })],
  ["--modules", valueFlag((o, value) => { o.modules = value?.split(",") || []; })],
  ["-m", valueFlag((o, value) => { o.modules = value?.split(",") || []; })],
  ["--security-url", valueFlag((o, value) => { o.securityUrl = value; })],
  ["--env", valueFlag(setEnvMode)],
  ["-e", valueFlag(setEnvMode)],
  ["--engine", valueFlag(setEngine)],
  ["--package", valueFlag((o, value) => { o.packageName = value; })],
  ["--version", handleVersion],
  ["--help", showHelp],
  ["-h", showHelp],
]);

/** `--format` consumes its value only when it is a known format. */
function formatFlag(options: ExtendedCliOptions, value: string | undefined): number {
  if (!value || !["json", "text", "html", "csv"].includes(value)) return 0;
  options.format = value as OutputFormat;
  return 1;
}

function setEnvMode(options: ExtendedCliOptions, value: string | undefined): void {
  if (value !== "build" && value !== "prod") {
    throw new Error(`Invalid environment mode '${value ?? ""}'. Expected 'build' or 'prod'.`);
  }
  options.env = value;
}

function setEngine(options: ExtendedCliOptions, value: string | undefined): void {
  if (!isValidationEngine(value)) {
    throw new Error(`Invalid validation engine '${value ?? ""}'. Expected one of: ${VALIDATION_ENGINES.join(", ")}.`);
  }
  options.engine = value;
}

function parseArgs(args: string[]): ExtendedCliOptions {
  const options: ExtendedCliOptions = {
    format: "text",
    verbose: false,
    failOnWarning: false,
    command: "audit",
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    const command = COMMAND_WORDS.get(arg);
    if (command) {
      options.command = command;
      continue;
    }
    i += FLAG_HANDLERS.get(arg)?.(options, args[i + 1]) ?? 0;
  }

  options.projectRoot ||= process.cwd();
  return options;
}

function printHelp(command: "audit" | "resolve" = "audit"): void {
  if (command === "resolve") {
    console.log(`
╔═══════════════════════════════════════════════════════════════╗
║              Muraqib Resolve - Dependency Resolution           ║
╚═══════════════════════════════════════════════════════════════╝

USAGE:
  muraqib [-p <path>] resolve [--osv]

DESCRIPTION:
  Build an evidence-based dependency resolution plan from OSV data, ask for
  approval, apply it, verify the result and roll back on failure.

OPTIONS:
  -p, --project <path>       Project root directory (default: cwd); place it before "resolve"
      --osv                  Accepted for parity with audit (resolve always uses OSV data)
  -h, --help                 Show this help message

EXAMPLES:
  muraqib resolve
  muraqib -p ./my-app resolve

For more information, visit: https://github.com/Muraqib-Core/muraqib
`);
  } else {
    console.log(`
╔═══════════════════════════════════════════════════════════════╗
║                  Muraqib Core CLI - Help                      ║
╚═══════════════════════════════════════════════════════════════╝

USAGE:
  muraqib [command] [options]

COMMANDS:
  audit                      Run full audit (default)
  resolve                    Resolve dependency conflicts
  agent                      Audit and print a deterministic JSON report for AI agents
  context                    Print Muraqib's capabilities as JSON (agent system context)
  tool-schema                Print tool definitions (MCP / tool-use compatible) as JSON
  image --image <name>       Trivy scan of a local Docker image
  runtime --container <name> Read-only inspection of a running container

OPTIONS:
  -p, --project <path>       Project root directory (default: cwd)
  -f, --format <format>      Output format: json|text|html|csv (default: text)
  -o, --output <path>        Output file path (default: stdout)
  -v, --verbose              Enable verbose logging
  -m, --modules <list>       Specific modules to run (comma-separated)
      --fail-on-warning      Exit with code 1 if warnings found
      --osv                  Enable OSV vulnerability scanning
      -e, --env <build|prod> Blocking policy mode for the scan layer (implies the scan layer)
      --engine <name>        Env validation engine: custom, zod, valibot, arktype (implies the scan layer)
      --docker               Enable Docker discovery
      --ai-advisory          Enable AI-powered advisory
      --docker-native        Use the local Docker daemon for image checks
      --json                 Shorthand for --format json
  -i, --interactive          Guided mode: pick what to audit, view a colour-coded report (TTY only)
      --no-interactive       Disable the spinner/prompts even in a terminal
      --max-issues <n>       Cap issues returned by the agent command
  -h, --help                 Show this help message
      --version              Show version information

EXAMPLES:
  # Run full audit
  muraqib

  # Generate HTML report
  muraqib audit --format html --output report.html

  # JSON output for CI/CD
  muraqib audit --format json --project ./src

  # Run specific modules
  muraqib audit --modules memory-guard,security-guard

  # Add OSV vulnerability scanning to the audit
  muraqib audit --osv

FORMATS:
  text   - Human-readable terminal output (default)
  json   - JSON format for programmatic processing
  html   - Interactive HTML report
  csv    - Spreadsheet-compatible format

For more information, visit: https://github.com/Muraqib-Core/muraqib
`);
  }
}

/**
 * Create audit report.
 *
 * @param options - Options
 * @returns Create audit report result
 */
export async function createAuditReport(
  options: CliOptions & {
    securityUrl?: string | undefined;
    scan?: boolean;
    aiAdvisory?: boolean;
    dockerNative?: boolean;
    env?: "build" | "prod" | undefined;
    engine?: ValidationEngineName | undefined;
  }
): Promise<AuditReport> {
  const root = options.projectRoot;
  const { results: scanned, aiAdvisory: aiText } = await collectAuditResults({
    projectRoot: root,
    modules: options.modules,
    securityUrl: options.securityUrl,
    scan: options.scan,
    aiAdvisory: options.aiAdvisory,
    dockerNative: options.dockerNative,
    mode: options.env,
    engine: options.engine,
  });

  const issues = scanned.flatMap((r) => r.issues);
  const count = (sev: string) => issues.filter((i) => i.severity === sev).length;

  const modules: Record<string, unknown> = {};
  for (const r of scanned) modules[r.module] = r;
  if (aiText) modules["ai-advisory"] = { advisory: aiText };

  return {
    timestamp: Date.now(),
    projectRoot: root,
    exitCode: auditExitCode(scanned, options.failOnWarning),
    summary: {
      total: issues.length,
      critical: count("critical"),
      error: count("error"),
      warning: count("warning"),
      info: count("info"),
    },
    modules,
  };
}

const SCAN_COMMANDS = new Set(["resolve", "image", "runtime"]);

// Flags belonging to the 13-module workflow (--skip-*, --url, --upgrade, ...)
const WORKFLOW_FLAGS = new Set(["--url", "--path", "--upgrade", "--safe", "--presets", "--schedule", "--silent"]);
function usesWorkflowFlags(args: string[]): boolean {
  return args.some((a) => a.startsWith("--skip-") || WORKFLOW_FLAGS.has(a));
}

type InteractiveUi = typeof import("./interactive.js");

/** Runs the scan layer's CLI (resolve / image / runtime) and returns the exit code it set. */
async function runScanLayer(scanArgs: string[]): Promise<number> {
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
async function loadInteractiveUi(options: ExtendedCliOptions): Promise<InteractiveUi | null> {
  const interactive = shouldUseInteractive({
    flag: options.interactive,
    format: options.format ?? "text",
    hasOutputFile: Boolean(options.output),
    stdoutIsTTY: Boolean(process.stdout.isTTY),
    stdinIsTTY: Boolean(process.stdin.isTTY),
    env: process.env,
  });
  // Loaded on demand so importing the library never pulls in @clack/prompts
  const ui = interactive ? await import("./interactive.js") : null;
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
async function runAuditCommand(options: ExtendedCliOptions): Promise<number> {
  const ui = await loadInteractiveUi(options);
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
async function runCommand(command: NonNullable<ExtendedCliOptions["command"]>, options: ExtendedCliOptions): Promise<number> {
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
    default:
      return runAuditCommand(options);
  }
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
    return await runCommand(command, options);
  } catch (error) {
    console.error(
      "❌ Error:",
      error instanceof Error ? error.message : String(error)
    );
    return 1;
  }
}

/** Read the package version at runtime so `--version` never drifts from package.json. */
function readPackageVersion(): string {
  try {
    const pkgPath = fileURLToPath(new URL("../../package.json", import.meta.url));
    const pkg: unknown = JSON.parse(readFileSync(pkgPath, "utf8"));
    if (typeof pkg === "object" && pkg !== null && "version" in pkg && typeof pkg.version === "string") {
      return pkg.version;
    }
  } catch {
    // fall through to the placeholder
  }
  return "unknown";
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
