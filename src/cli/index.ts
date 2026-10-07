/**
 * Muraqib CLI - Command Line Interface
 * Main entry point for running audits from the command line
 */
import { writeFileSync } from "fs";
import { join } from "path";
import type { CliOptions, AuditReport, OutputFormat } from "./types.js";
import { formatReport } from "./formatters.js";

export { formatReport } from "./formatters.js";
export type { CliOptions, AuditReport, OutputFormat } from "./types.js";

function parseArgs(args: string[]): Partial<CliOptions> {
  const options: Partial<CliOptions> = {
    format: "text",
    verbose: false,
    failOnWarning: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

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

    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }

    if (arg === "--version") {
      console.log("Muraqib Core v1.0.0");
      process.exit(0);
    }
  }

  if (!options.projectRoot) {
    options.projectRoot = process.cwd();
  }

  return options;
}

function printHelp(): void {
  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║                  Muraqib Core CLI - Help                      ║
╚═══════════════════════════════════════════════════════════════╝

USAGE:
  muraqib [options]

OPTIONS:
  -p, --project <path>       Project root directory (default: cwd)
  -f, --format <format>      Output format: json|text|html|csv
                             (default: text)
  -o, --output <path>        Output file path (default: stdout)
  -v, --verbose              Enable verbose logging
  -m, --modules <list>       Specific modules to run (comma-separated)
      --fail-on-warning      Exit with code 1 if warnings found
  -h, --help                 Show this help message
      --version              Show version information

EXAMPLES:
  # Run full audit with text output
  muraqib

  # Generate HTML report
  muraqib --format html --output report.html

  # JSON output for CI/CD
  muraqib --format json --project ./src

  # Run specific modules
  muraqib --modules memory-guard,security-guard

FORMATS:
  text   - Human-readable terminal output (default)
  json   - JSON format for programmatic processing
  html   - Interactive HTML report
  csv    - Spreadsheet-compatible format

For more information, visit: https://github.com/Ayaalmadhon2004/-Muraqib-Core
`);
}

export async function createAuditReport(
  options: CliOptions
): Promise<AuditReport> {
  const report: AuditReport = {
    timestamp: Date.now(),
    projectRoot: options.projectRoot,
    summary: {
      total: 0,
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
    },
    modules: {},
  };

  return report;
}

export async function runCli(args: string[]): Promise<number> {
  try {
    const options = parseArgs(args) as CliOptions;

    if (options.verbose) {
      console.log("🚀 Starting Muraqib Core audit...");
      console.log(`📁 Project root: ${options.projectRoot}`);
      console.log(`📊 Format: ${options.format}`);
    }

    const report = await createAuditReport(options);

    const formatted = formatReport(report, options.format);

    if (options.output) {
      const outputPath = join(process.cwd(), options.output);
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

    return 0;
  } catch (error) {
    console.error(
      "❌ Error:",
      error instanceof Error ? error.message : String(error)
    );
    return 1;
  }
}

// CLI entry point
if (require.main === module) {
  const args = process.argv.slice(2);
  runCli(args)
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error("Fatal error:", error);
      process.exit(1);
    });
}
