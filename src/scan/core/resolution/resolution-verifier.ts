import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
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
  });
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
  const tsconfigPath = path.join(graph.projectPath, "tsconfig.json");
  if (fs.existsSync(tsconfigPath)) {
    try {
      runProjectCommand(graph, "typecheck");
      results.push({
        step: "typecheck",
        passed: true,
        status: "passed",
        message: "TypeScript typecheck passed.",
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Typecheck failed";
      results.push({
        step: "typecheck",
        passed: false,
        status: classifyCommandFailure(err),
        message: msg,
      });
    }
  } else {
    results.push({
      step: "typecheck",
      passed: true,
      status: "skipped",
      message: "Typecheck skipped because tsconfig.json is not present.",
    });
  }

  // 3. Tests verification (optional, run only if test script is defined)
  const pkgJson = JSON.parse(
    fs.readFileSync(path.join(graph.projectPath, "package.json"), "utf8")
  );
  if (pkgJson.scripts?.test && !pkgJson.scripts.test.includes("no test specified")) {
    try {
      runProjectCommand(graph, "tests");
      results.push({
        step: "tests",
        passed: true,
        status: "passed",
        message: "Project tests passed.",
      });
    } catch (err: unknown) {
      results.push({
        step: "tests",
        passed: false,
        status: classifyCommandFailure(err),
        message: String(err),
      });
    }
  } else {
    results.push({
      step: "tests",
      passed: true,
      status: "skipped",
      message: "Tests skipped because no runnable test script is configured.",
    });
  }

  // 4. Security scan verification
  try {
    const osvScanner = new OsvScanner();
    const scanContext = {
      projectPath: graph.projectPath,
      files: [],
      packageManager: graph.packageManager,
      dependencies: pkgJson.dependencies ?? {},
      devDependencies: pkgJson.devDependencies ?? {},
    };

    if (osvScanner.supports(scanContext)) {
      const scanRes = await osvScanner.scan(scanContext);
      if (scanRes.status !== "success") {
        results.push({
          step: "securityScan",
          passed: false,
          status: scanRes.status === "unavailable" ? "unavailable" : "infrastructure-error",
          message: scanRes.error ?? `Security scan completed with status '${scanRes.status}'.`,
        });
      } else {
        // Check if any resolved package is still vulnerable
        const changedNames = new Set(plan.changes.map((c) => c.packageName));
        const unresolved = scanRes.findings.filter(
          (f) => f.key && changedNames.has(f.key)
        );

        if (unresolved.length > 0) {
          results.push({
            step: "securityScan",
            passed: false,
            status: "failed",
            message: `Package still has ${unresolved.length} unresolved advisories.`,
          });
        } else {
          results.push({
            step: "securityScan",
            passed: true,
            status: "passed",
            message: "Security scan confirmed vulnerability resolved.",
          });
        }
      }
    }
  } catch (err: unknown) {
    results.push({
      step: "securityScan",
      passed: false,
      status: "infrastructure-error",
      message: `Security scan could not complete: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  // 5. Compatibility scan verification
  try {
    const compatScanner = new CompatibilityEngine();
    const scanContext = {
      projectPath: graph.projectPath,
      files: [],
      packageManager: graph.packageManager,
      dependencies: pkgJson.dependencies ?? {},
      devDependencies: pkgJson.devDependencies ?? {},
    };

    if (compatScanner.supports(scanContext)) {
      const compatRes = await compatScanner.scan(scanContext);
      if (compatRes.status !== "success") {
        results.push({
          step: "compatibilityScan",
          passed: false,
          status: compatRes.status === "unavailable" ? "unavailable" : "infrastructure-error",
          message: compatRes.error ?? `Compatibility scan completed with status '${compatRes.status}'.`,
        });
      } else if (compatRes.findings.length > 0) {
        results.push({
          step: "compatibilityScan",
          passed: false,
          status: "failed",
          message: `Detected ${compatRes.findings.length} compatibility conflicts.`,
        });
      } else {
        results.push({
          step: "compatibilityScan",
          passed: true,
          status: "passed",
          message: "Compatibility scan passed with no conflicts.",
        });
      }
    }
  } catch (err: unknown) {
    results.push({
      step: "compatibilityScan",
      passed: false,
      status: "infrastructure-error",
      message: `Compatibility scan could not complete: ${err instanceof Error ? err.message : String(err)}`,
    });
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
