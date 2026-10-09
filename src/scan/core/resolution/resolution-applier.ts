import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import type {
  ResolutionPlan,
  ApprovalDecision,
  ResolutionResult,
  VerificationStepResult,
  PackageChange,
} from "./resolution-plan.js";
import { DependencyGraph } from "./dependency-graph.js";
import { OsvScanner } from "../../scanners/dependency/osv-engine.js";
import { CompatibilityEngine } from "../../scanners/compatibility/compatibility-engine.js";

export class ResolutionApplier {
  private graph: DependencyGraph;

  constructor(graph: DependencyGraph) {
    this.graph = graph;
  }

  /**
   * Applies an approved resolution plan.
   * STRICT APPROVAL BOUNDARY: Requires decision === "approved".
   */
  public async apply(
    plan: ResolutionPlan,
    decision: ApprovalDecision
  ): Promise<ResolutionResult> {
    // 1. HARD APPROVAL BOUNDARY CHECK
    if (decision !== "approved") {
      return {
        applied: false,
        status: "rejected",
        message: "Resolution cancelled. No changes were applied.",
      };
    }

    // 2. STALE PLAN PROTECTION
    const staleCheck = this.verifyProjectState(plan);
    if (!staleCheck.valid) {
      return {
        applied: false,
        status: "stale",
        message: `Plan is stale and cannot be applied: ${staleCheck.reason}`,
      };
    }

    const originalFiles = this.captureProjectFiles();

    // 3. MUTATION: Update package.json
    try {
      this.mutatePackageJson(plan.changes);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        applied: false,
        status: "failed",
        message: `Failed to update package.json: ${msg}`,
      };
    }

    // 4. PACKAGE MANAGER & LOCKFILE UPDATE
    try {
      this.runPackageManagerInstall();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.restoreProjectFiles(originalFiles);
      return {
        applied: false,
        status: "failed",
        message: `Package manager failed. package.json and the lockfile were restored; run a clean install before continuing: ${msg}`,
        appliedChanges: plan.changes,
        rolledBack: true,
      };
    }

    // 5. POST-MUTATION VERIFICATION
    const verificationResults = await this.runVerification(plan);
    const hasFailures = verificationResults.some((r) => !r.passed);

    if (hasFailures) {
      const failedSteps = verificationResults
        .filter((r) => !r.passed)
        .map((r) => `${r.step} (${r.message})`)
        .join(", ");

      this.restoreProjectFiles(originalFiles);
      return {
        applied: false,
        status: "failed",
        message: `Verification failed. package.json and the lockfile were restored; run a clean install before continuing: ${failedSteps}`,
        appliedChanges: plan.changes,
        verificationResults,
        rolledBack: true,
      };
    }

    return {
      applied: true,
      status: "applied",
      message: "Resolution completed successfully.",
      appliedChanges: plan.changes,
      verificationResults,
    };
  }

  /**
   * Verifies that the current project state matches the state used to generate the plan.
   */
  private verifyProjectState(plan: ResolutionPlan): { valid: boolean; reason?: string } {
    const pkgPath = path.join(this.graph.projectPath, "package.json");
    if (!fs.existsSync(pkgPath)) {
      return { valid: false, reason: "package.json no longer exists" };
    }

    if (plan.baseFingerprint && this.graph.createFingerprint() !== plan.baseFingerprint) {
      return {
        valid: false,
        reason: "project manifest, lockfile, or package-manager configuration changed",
      };
    }

    let pkg: any;
    try {
      pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    } catch {
      return { valid: false, reason: "Unable to parse package.json" };
    }

    const allDeps: Record<string, string> = {
      ...(pkg.dependencies || {}),
      ...(pkg.devDependencies || {}),
      ...(pkg.peerDependencies || {}),
      ...(pkg.optionalDependencies || {}),
    };

    for (const change of plan.changes) {
      const declared = allDeps[change.packageName];
      if (!declared) {
        return {
          valid: false,
          reason: `Package '${change.packageName}' is no longer declared in package.json`,
        };
      }

      const cleanDeclared = declared.replace(/[\^~]/g, "");
      const installedMeta = this.graph.getInstalledMeta(change.packageName);

      if (installedMeta) {
        if (installedMeta.version !== change.currentVersion) {
          return {
            valid: false,
            reason: `Installed version for '${change.packageName}' changed from ${change.currentVersion} to ${installedMeta.version}`,
          };
        }
      } else if (cleanDeclared !== change.currentVersion) {
        return {
          valid: false,
          reason: `Declared version for '${change.packageName}' (${cleanDeclared}) does not match planned version (${change.currentVersion})`,
        };
      }
    }

    return { valid: true };
  }

  /**
   * Mutates dependency versions in package.json preserving range prefixes.
   */
  private mutatePackageJson(changes: PackageChange[]): void {
    const pkgPath = path.join(this.graph.projectPath, "package.json");
    const content = fs.readFileSync(pkgPath, "utf8");
    const pkg = JSON.parse(content);

    for (const change of changes) {
      const target = change.targetVersion;
      let matchedSection = false;

      for (const section of [
        "dependencies",
        "devDependencies",
        "peerDependencies",
        "optionalDependencies",
      ] as const) {
        if (pkg[section] && pkg[section][change.packageName]) {
          const currentDecl: string = pkg[section][change.packageName];
          const simpleDeclaration = currentDecl.match(
            /^([~^]?)(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/
          );
          if (!simpleDeclaration) {
            throw new Error(
              `Unsupported version declaration '${currentDecl}' for '${change.packageName}'. ` +
              "Only exact, caret, and tilde semver declarations can be changed automatically."
            );
          }
          const prefix = simpleDeclaration[1] ?? "";
          pkg[section][change.packageName] = `${prefix}${target}`;
          matchedSection = true;
          break;
        }
      }

      if (!matchedSection) {
        if (!pkg.dependencies) pkg.dependencies = {};
        pkg.dependencies[change.packageName] = target;
      }
    }

    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf8");
  }

  private captureProjectFiles(): Map<string, Buffer | null> {
    const files = new Set<string>([
      path.join(this.graph.projectPath, "package.json"),
    ]);
    files.add(this.graph.lockfilePath ?? this.expectedLockfilePath());

    const snapshot = new Map<string, Buffer | null>();
    for (const file of files) {
      snapshot.set(file, fs.existsSync(file) ? fs.readFileSync(file) : null);
    }
    return snapshot;
  }

  private expectedLockfilePath(): string {
    const lockfiles: Record<string, string> = {
      pnpm: "pnpm-lock.yaml",
      npm: "package-lock.json",
      yarn: "yarn.lock",
      bun: "bun.lockb",
    };
    return path.join(this.graph.projectPath, lockfiles[this.graph.packageManager]!);
  }

  private restoreProjectFiles(snapshot: Map<string, Buffer | null>): void {
    for (const [file, content] of snapshot) {
      if (content === null) {
        if (fs.existsSync(file)) fs.unlinkSync(file);
      } else {
        fs.writeFileSync(file, content);
      }
    }
  }

  /**
   * Runs the correct package manager without hardcoding.
   */
  private runPackageManagerInstall(): void {
    const manager = this.graph.packageManager;
    execFileSync(manager, ["install"], {
      cwd: this.graph.projectPath,
      stdio: "pipe",
      env: process.env,
      timeout: 300_000,
    });
  }

  private runProjectCommand(kind: "typecheck" | "tests"): void {
    const manager = this.graph.packageManager;
    const args = kind === "tests"
      ? ["run", "test"]
      : manager === "npm"
        ? ["exec", "--", "tsc", "--noEmit"]
        : manager === "bun"
          ? ["x", "tsc", "--noEmit"]
          : ["exec", "tsc", "--noEmit"];

    execFileSync(manager, args, {
      cwd: this.graph.projectPath,
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
  private async runVerification(plan: ResolutionPlan): Promise<VerificationStepResult[]> {
    const results: VerificationStepResult[] = [];

    // 1. Dependency installation verification
    results.push({
      step: "dependencies",
      passed: true,
      status: "passed",
      message: "Dependencies installed and lockfile updated.",
    });

    // 2. Typecheck verification
    const tsconfigPath = path.join(this.graph.projectPath, "tsconfig.json");
    if (fs.existsSync(tsconfigPath)) {
      try {
        this.runProjectCommand("typecheck");
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
          status: this.classifyCommandFailure(err),
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
      fs.readFileSync(path.join(this.graph.projectPath, "package.json"), "utf8")
    );
    if (pkgJson.scripts?.test && !pkgJson.scripts.test.includes("no test specified")) {
      try {
        this.runProjectCommand("tests");
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
          status: this.classifyCommandFailure(err),
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
        projectPath: this.graph.projectPath,
        files: [],
        packageManager: this.graph.packageManager,
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
        projectPath: this.graph.projectPath,
        files: [],
        packageManager: this.graph.packageManager,
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

  private classifyCommandFailure(error: unknown): "failed" | "unavailable" | "timed-out" | "infrastructure-error" {
    if (typeof error === "object" && error !== null && "code" in error) {
      const code = String((error as { code?: unknown }).code ?? "");
      if (code === "ENOENT") return "unavailable";
      if (code === "ETIMEDOUT") return "timed-out";
    }
    return error instanceof Error ? "failed" : "infrastructure-error";
  }
}
