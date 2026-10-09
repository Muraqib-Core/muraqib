import { pathToFileURL } from "node:url";
import * as x from "@clack/prompts";
import { styleText, parseArgs } from "node:util";
import { createProjectContext } from "./core/context/project-context.js";
import { AuditRunner } from "./core/runner/audit-runner.js";
import { renderFindings } from "./cli/renderers/finding-renderer.js";
import { formatSummaryText } from "./cli/renderers/summary-renderer.js";
import { renderAiAdvisory } from "./cli/renderers/ai-renderer.js";
import { renderJsonReport } from "./cli/renderers/json-renderer.js";
import type { ValidationEngineName } from "./guard/core/engine-detector.js";
import { runResolveWorkflow } from "./cli/resolve-workflow.js";
import { DockerImageScanner } from "./scanners/docker/image-engine.js";
import { DockerRuntimeScanner } from "./scanners/docker/runtime-engine.js";
import type { ScanResult } from "./core/contracts/scanner-engine.js";

function renderTargetScan(result: ScanResult, json: boolean): number {
  const exitCode = result.status === "success" ? (result.findings.some(f => f.severity === "high" || f.severity === "critical") ? 1 : 0) : 3;
  if (json) {
    console.log(JSON.stringify({ schemaVersion: "1.2", status: exitCode === 3 ? "error" : exitCode === 1 ? "failed" : "passed", exitCode, scannerCoverage: [{ scanner: result.scanner, status: result.status, scannedInputs: result.scannedInputs ?? [], skippedInputs: result.skippedInputs ?? [], diagnostics: result.diagnostics ?? [] }], findings: result.findings }, null, 2));
  } else {
    renderFindings(result.findings);
    console.log(`${result.scanner}: ${result.status}`);
    for (const diagnostic of result.diagnostics ?? []) console.log(`  ${diagnostic}`);
  }
  return exitCode;
}

export async function main(argv: string[] = process.argv.slice(2)) {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      env: {
        type: "string",
        short: "e",
      },
      engine: {
        type: "string",
      },
      json: {
        type: "boolean",
      },
      ai: {
        type: "boolean",
      },
      image: { type: "string" },
      container: { type: "string" },
      "docker-native": { type: "boolean" },
      help: {
        type: "boolean",
        short: "h",
      },
    },
    allowPositionals: true,
    strict: true,
  });

  const command = positionals[0] || "audit";
  const isJson = Boolean(values.json);

  if (values.help) {
    console.log(`Muraqib — local-first DevSecOps audit CLI

Usage:
  muraqib audit [-e build|prod] [--engine custom|zod|valibot|arktype] [--json] [--ai] [--docker-native]
  muraqib resolve
  muraqib image --image <local-image> [--json]
  muraqib runtime --container <running-container> [--json]

Options:
  -e, --env       Blocking policy mode (build or prod)
      --engine    Environment validation engine
      --json      Machine-readable output
      --ai        Enable optional AI advisory output
      --image     Select an existing local Docker image for explicit Trivy analysis
      --container Select a container for read-only runtime inspection
      --docker-native Opt in to Docker CLI build and effective Compose checks
  -h, --help      Show this help`);
    return;
  }

  if (command !== "audit" && command !== "resolve" && command !== "image" && command !== "runtime") {
    throw new Error(`Unknown command '${command}'. Use --help for usage.`);
  }

  if (typeof values.env === "string" && values.env !== "build" && values.env !== "prod") {
    throw new Error(`Invalid environment mode '${values.env}'. Expected 'build' or 'prod'.`);
  }

  const allowedEngines = new Set(["custom", "zod", "valibot", "arktype"]);
  if (typeof values.engine === "string" && !allowedEngines.has(values.engine)) {
    throw new Error(`Invalid validation engine '${values.engine}'.`);
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

  const context = createProjectContext(process.cwd());

  if (command === "resolve") {
    await runResolveWorkflow(context);
    return;
  }

  if (!isJson) {
    x.intro(
      `${styleText(["bgCyan", "black"], "Muraqib 🛡️ ")} ${styleText("dim", "◈ DevSecOps Config & Dependency Auditor")}`
    );
  }

  let mode: string | undefined = typeof values.env === "string" ? values.env : undefined;

  if (!isJson) {
    if (mode) {
      x.log.info(`Environment passed via flag: ${styleText("cyan", mode)}`);
    } else {
      const selected = await x.select({
        message: "Select the tracking & monitoring environment:",
        options: [
          {
            value: "build",
            label: "Build Mode",
            hint: "Fast local checks for syntax errors & duplicate keys",
          },
          {
            value: "prod",
            label: "Production Mode",
            hint: "Strict security auditing for leaked tokens & weak secrets",
          },
        ],
      });

      if (x.isCancel(selected)) {
        x.cancel("Scan cancelled by user.");
        process.exit(0);
      }

      mode = String(selected);
    }
  }

  const preferredEngine =
    typeof values.engine === "string" ? (values.engine as ValidationEngineName) : undefined;

  let spinner: ReturnType<typeof x.spinner> | null = null;
  if (!isJson) {
    spinner = x.spinner();
    spinner.start("🔍 Executing comprehensive security & configuration audit...");
  }

  const runner = new AuditRunner();
  let report;

  try {
    report = await runner.run(context, {
      mode: mode === "prod" ? "prod" : "build",
      engine: preferredEngine,
      enableAi: Boolean(values.ai),
      dockerNative: Boolean(values["docker-native"]),
    });
  } catch (err: unknown) {
    if (spinner) {
      spinner.stop("Audit execution failed!");
    }
    const msg = err instanceof Error ? err.message : String(err);
    if (isJson) {
      console.log(
        JSON.stringify(
          {
            schemaVersion: "1.0",
            status: "error",
            exitCode: 3,
            error: { code: "AUDIT_EXECUTION_FAILED", message: msg },
          },
          null,
          2
        )
      );
    } else {
      console.log("");
      x.outro(
        styleText("red", "Muraqib scan failed\n\n") +
        styleText("dim", "Cause:\n  ") +
        msg
      );
    }
    process.exit(3);
  }

  if (spinner) {
    spinner.stop(`Audit complete! ${styleText("dim", `[engine: ${report.engine}]`)}`);
  }

  if (isJson) {
    renderJsonReport(report);
    process.exit(report.exitCode);
  }

  // 1. Render findings
  renderFindings(report.findings);

  if (report.findings.some((f) => f.dependencyProblem !== undefined)) {
    console.log(
      `  ${styleText("cyan", "💡 Tip:")} Run ${styleText(["bold", "cyan"], "muraqib resolve")} to inspect evidence-based dependency resolution candidates.\n`
    );
  }

  // 2. Render AI advisory if present
  renderAiAdvisory(report.aiAdvisory);

  // 3. Render summary note
  x.note(formatSummaryText(report), "Muraqib Audit Summary");

  // 4. Outro & Exit
  if (report.exitCode === 3) {
    x.outro(
      styleText(
        "red",
        "Muraqib audit could not complete reliably due to a scanner failure. 🛑"
      )
    );
    process.exit(3);
  } else if (report.exitCode === 1) {
    x.outro(
      styleText(
        "red",
        "Muraqib scan failed. Please resolve the security/syntax errors above. ❌"
      )
    );
    process.exit(1);
  } else {
    x.outro(
      styleText(
        "green",
        "No blocking findings were detected by the checks that completed. ✨"
      )
    );
    process.exit(0);
  }
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Muraqib could not start: ${message}`);
    process.exitCode = 3;
  });
}
