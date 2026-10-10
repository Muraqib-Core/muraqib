/**
 * Muraqib CLI - Command Line Interface
 * Main entry point for running audits from the command line
 */
import { writeFileSync } from "fs";
import { resolve } from "path";
import type { CliOptions, AuditReport, OutputFormat } from "./types.js";
import { pathToFileURL } from "url";
import { formatReport } from "./formatters.js";
import { AuditOrchestrator } from "../core/orchestrator.js";
import { buildAuditContext } from "../core/audit-context.js";
import { runScanAudit } from "../scan/bridge.js";

export { formatReport } from "./formatters.js";
export type { CliOptions, AuditReport, OutputFormat } from "./types.js";

interface ExtendedCliOptions extends Partial<CliOptions> {
  command?: "audit" | "resolve";
  osv?: boolean;
  docker?: boolean;
  aiAdvisory?: boolean;
  packageName?: string;
  packageVersion?: string;
  securityUrl?: string;
}

function parseArgs(args: string[]): ExtendedCliOptions {
  const options: ExtendedCliOptions = {
    format: "text",
    verbose: false,
    failOnWarning: false,
    command: "audit",
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    // Command selection
    if (arg === "resolve") {
      options.command = "resolve";
      continue;
    }

    if (arg === "audit") {
      options.command = "audit";
      continue;
    }

    if (arg === "--format" || arg === "-f") {
      const value = args[i + 1];
      if (value && ["json", "text", "html", "csv"].includes(value)) {
        options.format = value as OutputFormat;
        i++;
      }
    }

    if (arg === "--output" || arg === "-o") {
      options.output = args[i + 1];
      i++;
    }

    if (arg === "--project" || arg === "-p") {
      options.projectRoot = args[i + 1] || process.cwd();
      i++;
    }

    if (arg === "--verbose" || arg === "-v") {
      options.verbose = true;
    }

    if (arg === "--fail-on-warning") {
      options.failOnWarning = true;
    }

    if (arg === "--modules" || arg === "-m") {
      options.modules = args[i + 1]?.split(",") || [];
      i++;
    }

    if (arg === "--security-url") {
      options.securityUrl = args[i + 1];
      i++;
    }

    // New filters
    if (arg === "--osv") {
      options.osv = true;
    }

    if (arg === "--docker") {
      options.docker = true;
    }

    if (arg === "--ai-advisory") {
      options.aiAdvisory = true;
    }

    // Resolve command options
    if (arg === "--package") {
      options.packageName = args[i + 1];
      i++;
    }

    if (arg === "--version" && options.command === "resolve") {
      options.packageVersion = args[i + 1];
      i++;
    }

    if (arg === "--help" || arg === "-h") {
      printHelp(options.command);
      process.exit(0);
    }

    if (arg === "--version" && options.command === "audit") {
      console.log("Muraqib Core v1.0.0");
      process.exit(0);
    }
  }

  if (!options.projectRoot) {
    options.projectRoot = process.cwd();
  }

  return options;
}

function printHelp(command: "audit" | "resolve" = "audit"): void {
  if (command === "resolve") {
    console.log(`
╔═══════════════════════════════════════════════════════════════╗
║              Muraqib Resolve - Dependency Resolution           ║
╚═══════════════════════════════════════════════════════════════╝

USAGE:
  muraqib [-p <path>] resolve

DESCRIPTION:
  Build an evidence-based dependency resolution plan from OSV data, ask for
  approval, apply it, verify the result and roll back on failure.

OPTIONS:
  -p, --project <path>       Project root directory (default: cwd); place it before "resolve"
  -h, --help                 Show this help message

EXAMPLES:
  muraqib resolve
  muraqib -p ./my-app resolve

For more information, visit: https://github.com/Ayaalmadhon2004/-Muraqib-Core
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
      --docker               Enable Docker discovery
      --ai-advisory          Enable AI-powered advisory
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

For more information, visit: https://github.com/Ayaalmadhon2004/-Muraqib-Core
`);
  }
}

export async function createAuditReport(
  options: CliOptions & { securityUrl?: string; scan?: boolean; aiAdvisory?: boolean; dockerNative?: boolean }
): Promise<AuditReport> {
  const root = options.projectRoot;
  const orchestrator = new AuditOrchestrator(buildAuditContext(root), {
    projectRoot: root,
    asyncTargetPath: root,
    configProjectRoot: root,
    dependencyTargetPath: root,
    dockerProjectRoot: root,
    imageTargetPath: root,
    deadCodeTargetPath: root,
    securityTargetUrl: options.securityUrl,
  });

  const unified = await orchestrator.execute();
  const wanted = options.modules?.map((m) => m.trim().toLowerCase()).filter(Boolean) ?? [];
  const selected = wanted.length
    ? unified.results.filter((r) => wanted.some((w) => r.module.toLowerCase().includes(w)))
    : unified.results;

  const scanned = [...selected];
  let aiText: string | null = null;
  if (options.scan) {
    const outcome = await runScanAudit(root, { enableAi: options.aiAdvisory ?? false, dockerNative: options.dockerNative ?? false });
    scanned.push(outcome.result);
    aiText = outcome.report.aiAdvisory;
  }

  const issues = scanned.flatMap((r) => r.issues);
  const count = (sev: string) => issues.filter((i) => i.severity === sev).length;

  const modules: Record<string, unknown> = {};
  for (const r of scanned) modules[r.module] = r;
  if (aiText) modules["ai-advisory"] = { advisory: aiText };

  return {
    timestamp: Date.now(),
    projectRoot: root,
    summary: {
      total: issues.length,
      critical: count("critical"),
      high: count("error"),
      medium: count("warning"),
      low: count("info"),
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

export async function runCli(args: string[]): Promise<number> {
  try {
    // resolve / image / runtime are served by the scan layer (dependency resolution, Trivy image, runtime inspection)
    if (args[0] && SCAN_COMMANDS.has(args[0])) {
      const { main: runScanCli } = await import("../scan/cli.js");
      process.exitCode = undefined;
      await runScanCli(args);
      return typeof process.exitCode === "number" ? process.exitCode : 0;
    }

    // Workflow-style audit (13 modules, --skip-*, --url, --upgrade ...) is served by the workflow runner
    if (usesWorkflowFlags(args) && !args.some((a) => SCAN_COMMANDS.has(a))) {
      const { run: runWorkflowCli } = await import("./audit-cli.js");
      await runWorkflowCli();
      return typeof process.exitCode === "number" ? process.exitCode : 0;
    }

    const options = parseArgs(args);
    const command = options.command || "audit";

    if (command === "resolve") {
      // `muraqib -p <dir> resolve ...` : run the real resolution workflow in the target project
      if (options.projectRoot) process.chdir(options.projectRoot);
      const { main: runScanCli } = await import("../scan/cli.js");
      process.exitCode = undefined;
      await runScanCli(["resolve"]);
      return typeof process.exitCode === "number" ? process.exitCode : 0;
    } else {
      // Default audit command
      const auditOptions = {
        ...(options as CliOptions & { securityUrl?: string }),
        scan: Boolean(options.osv || options.docker || options.aiAdvisory),
        aiAdvisory: options.aiAdvisory ?? false,
      };

      if (options.verbose) {
        console.log("🚀 Starting Muraqib Core audit...");
        console.log(`📁 Project root: ${auditOptions.projectRoot}`);
        console.log(`📊 Format: ${auditOptions.format}`);
      }

      const report = await createAuditReport(auditOptions);

      const formatted = formatReport(report, auditOptions.format);

      if (options.output) {
        const outputPath = resolve(process.cwd(), options.output);
        writeFileSync(outputPath, formatted);
        if (options.verbose) {
          console.log(`✅ Report saved to: ${outputPath}`);
        }
      } else {
        console.log(formatted);
      }

      if (options.verbose) {
        console.log("✅ Audit completed successfully");
      }

      const { summary } = report;
      if (summary.critical > 0 || summary.high > 0) return 1;
      if (auditOptions.failOnWarning && summary.medium > 0) return 1;
      return 0;
    }
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
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error("Fatal error:", error);
      process.exit(1);
    });
}
