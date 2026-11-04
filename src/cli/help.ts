/**
 * CLI help texts for the `audit` and `resolve` commands.
 */

export function printHelp(command: "audit" | "resolve" = "audit"): void {
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
  hook install|uninstall     Manage git hooks: pre-commit secret scan, opt-in pre-push audit (--pre-push)

OPTIONS:
  -p, --project <path>       Project root directory (default: cwd)
  -f, --format <format>      Output format: json|text|html|csv|md (default: text)
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
      --report               Shorthand for --format md (security scorecard & compliance report)
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

  # Markdown scorecard for a GitHub CI step summary
  muraqib audit --report --output "$GITHUB_STEP_SUMMARY"

  # Run specific modules
  muraqib audit --modules memory-guard,security-guard

  # Add OSV vulnerability scanning to the audit
  muraqib audit --osv

  # Block commits that stage secrets (add --pre-push for the heavier audit before pushing)
  muraqib hook install

FORMATS:
  text   - Human-readable terminal output (default)
  json   - JSON format for programmatic processing
  html   - Interactive HTML report
  csv    - Spreadsheet-compatible format
  md     - Markdown security scorecard (0-100 score, README badge, CI step summary)

For more information, visit: https://github.com/Muraqib-Core/muraqib
`);
  }
}
