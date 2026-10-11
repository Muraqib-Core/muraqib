import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { createProjectContext } from "./core/context/project-context.js";
import { renderFindings } from "./cli/renderers/finding-renderer.js";
import { runResolveWorkflow } from "./cli/resolve-workflow.js";
import { DockerImageScanner } from "./scanners/docker/image-engine.js";
import { DockerRuntimeScanner } from "./scanners/docker/runtime-engine.js";
import type { ScanResult } from "./core/contracts/scanner-engine.js";

const SCAN_COMMANDS = new Set(["resolve", "image", "runtime"]);

function renderTargetScan(result: ScanResult, json: boolean): number {
  const exitCode = result.status === "success" ? (result.findings.some(f => f.level === "high" || f.level === "critical") ? 1 : 0) : 3;
  if (json) {
    console.log(JSON.stringify({ schemaVersion: "2.0", status: exitCode === 3 ? "error" : exitCode === 1 ? "failed" : "passed", exitCode, scannerCoverage: [{ scanner: result.scanner, status: result.status, scannedInputs: result.scannedInputs ?? [], skippedInputs: result.skippedInputs ?? [], diagnostics: result.diagnostics ?? [] }], findings: result.findings }, null, 2));
  } else {
    renderFindings(result.findings);
    console.log(`${result.scanner}: ${result.status}`);
    for (const diagnostic of result.diagnostics ?? []) console.log(`  ${diagnostic}`);
  }
  return exitCode;
}

/**
 * Scan-layer subcommands (`resolve`, `image`, `runtime`).
 * The `audit` command lives in the primary CLI (`src/cli/index.ts`), which delegates here.
 */
export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      json: { type: "boolean" },
      image: { type: "string" },
      container: { type: "string" },
      // Accepted for flag parity with `audit --osv`; resolve always queries OSV.
      osv: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
    strict: true,
  });

  const command = positionals[0];
  const isJson = Boolean(values.json);

  if (values.help) {
    console.log(`Muraqib scan commands

Usage:
  muraqib resolve [--osv]
  muraqib image --image <local-image> [--json]
  muraqib runtime --container <running-container> [--json]

Options:
      --json      Machine-readable output
      --image     Select an existing local Docker image for explicit Trivy analysis
      --container Select a container for read-only runtime inspection
      --osv       Accepted by resolve for parity with audit (resolve always uses OSV data)
  -h, --help      Show this help

Run \`muraqib --help\` for the audit command.`);
    return;
  }

  if (command === undefined || !SCAN_COMMANDS.has(command)) {
    throw new Error(`Unknown command '${command ?? ""}'. Use --help for usage.`);
  }

  if (command === "image") {
    if (typeof values.image !== "string") throw new Error("Specify --image with an existing local image.");
    process.exitCode = renderTargetScan(await new DockerImageScanner().scan(values.image), isJson);
    return;
  }
  if (command === "runtime") {
    if (typeof values.container !== "string") throw new Error("Specify --container for read-only inspection.");
    process.exitCode = renderTargetScan(await new DockerRuntimeScanner().scan(values.container), isJson);
    return;
  }

  await runResolveWorkflow(createProjectContext(process.cwd()));
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Muraqib could not start: ${message}`);
    process.exitCode = 3;
  });
}
