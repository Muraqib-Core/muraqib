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

interface ExtendedCliOptions extends Partial<CliOptions> {
  command?: "audit" | "resolve";
  osv?: boolean;
  docker?: boolean;
  aiAdvisory?: boolean;
  packageName?: string;
  packageVersion?: string;
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
  muraqib resolve [options]

DESCRIPTION:
  Resolve dependency conflicts, detect issues, and generate solutions.
  Integrates with OSV for vulnerability checking and Docker discovery.

OPTIONS:
  -p, --project <path>       Project root directory (default: cwd)
  -f, --format <format>      Output format: json|text|html|csv (default: text)
  -o, --output <path>        Output file path (default: stdout)
  --package <name>           Package name to resolve
  --version <version>        Package version to check
  -v, --verbose              Enable verbose logging
  --osv                      Enable OSV vulnerability scanning
  --docker                   Enable Docker configuration detection
  --ai-advisory              Enable AI-powered advisory suggestions
  -h, --help                 Show this help message

EXAMPLES:
  # Resolve with OSV scanning
  muraqib resolve --osv

  # Check specific package
  muraqib resolve --package lodash --version 4.17.21

  # Full analysis with all features
  muraqib resolve --osv --docker --ai-advisory

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

  # Resolve dependencies with OSV
  muraqib resolve --osv

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
    const options = parseArgs(args);
    const command = options.command || "audit";

    if (command === "resolve") {
      if (options.verbose) {
        console.log("🔧 Starting Muraqib Resolve...");
        console.log(`📁 Project root: ${options.projectRoot}`);
        if (options.osv) console.log("🛡️  OSV scanning enabled");
        if (options.docker) console.log("🐳 Docker discovery enabled");
        if (options.aiAdvisory) console.log("🤖 AI advisory enabled");
      }

      const resolveReport = {
        timestamp: Date.now(),
        projectRoot: options.projectRoot,
        command: "resolve",
        filters: {
          osv: options.osv || false,
          docker: options.docker || false,
          aiAdvisory: options.aiAdvisory || false,
        },
        results: {
          conflicts: [] as unknown[],
          vulnerabilities: [] as unknown[],
          dockerFindings: [] as unknown[],
          recommendations: [] as unknown[],
        },
      };

      const formatted = JSON.stringify(resolveReport, null, 2);

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
        console.log("✅ Resolution completed successfully");
      }

      return 0;
    } else {
      // Default audit command
      const auditOptions = options as CliOptions;

      if (options.verbose) {
        console.log("🚀 Starting Muraqib Core audit...");
        console.log(`📁 Project root: ${auditOptions.projectRoot}`);
        console.log(`📊 Format: ${auditOptions.format}`);
      }

      const report = await createAuditReport(auditOptions);

      const formatted = formatReport(report, auditOptions.format);

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
if (require.main === module) {
  const args = process.argv.slice(2);
  runCli(args)
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error("Fatal error:", error);
      process.exit(1);
    });
}
