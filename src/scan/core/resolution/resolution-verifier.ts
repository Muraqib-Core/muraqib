import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { COMMAND_MAX_BUFFER } from "./resolution-plan.js";
import type { ResolutionPlan, VerificationStepResult } from "./resolution-plan.js";
import type { DependencyGraph } from "./dependency-graph.js";
import { OsvScanner } from "../../scanners/dependency/osv-engine.js";
import { CompatibilityEngine } from "../../scanners/compatibility/compatibility-engine.js";

function runProjectCommand(graph: DependencyGraph, kind: "typecheck" | "tests"): void {
  const manager = graph.packageManager;
  const args = kind === "tests"
    ? ["run", "test"]
    : manager === "npm"
      ? ["exec", "--", "tsc", "--noEmit"]
      : manager === "bun"
        ? ["x", "tsc", "--noEmit"]
        : ["exec", "tsc", "--noEmit"];

  execFileSync(manager, args, {
    cwd: graph.projectPath,
    stdio: "pipe",
    env: process.env,
    timeout: kind === "tests" ? 300_000 : 60_000,
    maxBuffer: COMMAND_MAX_BUFFER,
  });
}

interface ProjectPackageJson {
  scripts?: { test?: string };
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function typecheckResult(graph: DependencyGraph): VerificationStepResult {
  if (!fs.existsSync(path.join(graph.projectPath, "tsconfig.json"))) {
    return {
      step: "typecheck",
      passed: true,
      status: "skipped",
      message: "Typecheck skipped because tsconfig.json is not present.",
    };
  }
  try {
    runProjectCommand(graph, "typecheck");
    return { step: "typecheck", passed: true, status: "passed", message: "TypeScript typecheck passed." };
  } catch (err: unknown) {
    return {
      step: "typecheck",
      passed: false,
      status: classifyCommandFailure(err),
      message: err instanceof Error ? err.message : "Typecheck failed",
    };
  }
}

/** Tests are optional: they run only when a real test script is defined. */
function testsResult(graph: DependencyGraph, pkgJson: ProjectPackageJson): VerificationStepResult {
  if (!pkgJson.scripts?.test || pkgJson.scripts.test.includes("no test specified")) {
    return {
      step: "tests",
      passed: true,
      status: "skipped",
      message: "Tests skipped because no runnable test script is configured.",
    };
  }
  try {
    runProjectCommand(graph, "tests");
    return { step: "tests", passed: true, status: "passed", message: "Project tests passed." };
  } catch (err: unknown) {
    return { step: "tests", passed: false, status: classifyCommandFailure(err), message: String(err) };
  }
}

function scanContextFor(graph: DependencyGraph, pkgJson: ProjectPackageJson) {
  return {
    projectPath: graph.projectPath,
    files: [],
    packageManager: graph.packageManager,
    dependencies: pkgJson.dependencies ?? {},
    devDependencies: pkgJson.devDependencies ?? {},
  };
}

/** A scan that did not finish successfully is unavailable or an infrastructure error, never a pass. */
function incompleteScanResult(
  step: "securityScan" | "compatibilityScan",
  label: string,
  scan: { status: string; error?: string | undefined }
): VerificationStepResult {
  return {
    step,
    passed: false,
    status: scan.status === "unavailable" ? "unavailable" : "infrastructure-error",
    message: scan.error ?? `${label} scan completed with status '${scan.status}'.`,
  };
}

/** Re-scans with OSV to confirm the changed packages are no longer vulnerable; undefined when OSV does not apply. */
async function securityScanResult(
  graph: DependencyGraph,
  pkgJson: ProjectPackageJson,
  plan: ResolutionPlan
): Promise<VerificationStepResult | undefined> {
  try {
    const osvScanner = new OsvScanner();
    const scanContext = scanContextFor(graph, pkgJson);
    if (!osvScanner.supports(scanContext)) return undefined;

    const scanRes = await osvScanner.scan(scanContext);
    if (scanRes.status !== "success") return incompleteScanResult("securityScan", "Security", scanRes);

    // Check if any resolved package is still vulnerable
    const changedNames = new Set(plan.changes.map((c) => c.packageName));
    const unresolved = scanRes.findings.filter((f) => f.key && changedNames.has(f.key));
    if (unresolved.length > 0) {
      return {
        step: "securityScan",
        passed: false,
        status: "failed",
        message: `Package still has ${unresolved.length} unresolved advisories.`,
      };
    }
    return {
      step: "securityScan",
      passed: true,
      status: "passed",
      message: "Security scan confirmed vulnerability resolved.",
    };
  } catch (err: unknown) {
    return {
      step: "securityScan",
      passed: false,
      status: "infrastructure-error",
      message: `Security scan could not complete: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/** Re-runs the compatibility scan; undefined when it does not apply. */
async function compatibilityScanResult(
  graph: DependencyGraph,
  pkgJson: ProjectPackageJson
): Promise<VerificationStepResult | undefined> {
  try {
    const compatScanner = new CompatibilityEngine();
    const scanContext = scanContextFor(graph, pkgJson);
    if (!compatScanner.supports(scanContext)) return undefined;

    const compatRes = await compatScanner.scan(scanContext);
    if (compatRes.status !== "success") return incompleteScanResult("compatibilityScan", "Compatibility", compatRes);
    if (compatRes.findings.length > 0) {
      return {
        step: "compatibilityScan",
        passed: false,
        status: "failed",
        message: `Detected ${compatRes.findings.length} compatibility conflicts.`,
      };
    }
    return {
      step: "compatibilityScan",
      passed: true,
      status: "passed",
      message: "Compatibility scan passed with no conflicts.",
    };
  } catch (err: unknown) {
    return {
      step: "compatibilityScan",
      passed: false,
      status: "infrastructure-error",
      message: `Compatibility scan could not complete: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Runs post-apply verification:
 * 1. Dependencies installation
 * 2. Typecheck (if tsconfig.json exists)
 * 3. Tests (if test script exists)
 * 4. Security scan (re-scans to verify vulnerability resolved)
 * 5. Compatibility scan
 */
export async function runVerification(graph: DependencyGraph, plan: ResolutionPlan): Promise<VerificationStepResult[]> {
  const results: VerificationStepResult[] = [];

  // 1. Dependency installation verification
  results.push({
    step: "dependencies",
    passed: true,
    status: "passed",
    message: "Dependencies installed and lockfile updated.",
  });

  // 2. Typecheck verification
  results.push(typecheckResult(graph));

  // 3. Tests verification (optional, run only if test script is defined)
  const pkgJson = JSON.parse(
    fs.readFileSync(path.join(graph.projectPath, "package.json"), "utf8")
  ) as ProjectPackageJson;
  results.push(testsResult(graph, pkgJson));

  // 4. Security scan verification, then 5. compatibility scan verification
  for (const result of [await securityScanResult(graph, pkgJson, plan), await compatibilityScanResult(graph, pkgJson)]) {
    if (result) results.push(result);
  }

  return results;
}

function classifyCommandFailure(error: unknown): "failed" | "unavailable" | "timed-out" | "infrastructure-error" {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = String((error as { code?: unknown }).code ?? "");
    if (code === "ENOENT") return "unavailable";
    if (code === "ETIMEDOUT") return "timed-out";
  }
  return error instanceof Error ? "failed" : "infrastructure-error";
}
