import * as fs from "node:fs";
import * as path from "node:path";
import type { ScannerEngine, ScanContext, ScanResult } from "../../core/contracts/scanner-engine.js";
import { createScanIssue, type DependencyType, type ScanIssueInput } from "../../core/findings/finding.js";
import { queryOsv, type OsvVulnerability, type OsvVulnerabilityEvent } from "./osv-client.js";
import { nonEmpty } from "../../../utils/defaults.js";
import { compareVersions } from "../../../utils/version-compare.js";

interface PackageToScan {
  name: string;
  declaredVersion: string;
  installedVersion: string;
  dependencyType: DependencyType;
}

const PRERELEASE_MARKERS = ["-beta", "-rc", "-alpha"];

/** The event list of every range of every affected entry, skipping entries that have none. */
function* eventLists(vulns: OsvVulnerability[]): Generator<OsvVulnerabilityEvent[]> {
  for (const vuln of vulns) {
    for (const item of vuln.affected ?? []) {
      for (const range of item.ranges ?? []) {
        if (range.events) yield range.events;
      }
    }
  }
}

/** ">= introduced < fixed" from the first introduced and first fixed events; undefined when there are neither. */
function describeRange(events: OsvVulnerabilityEvent[]): string | undefined {
  const intro = events.find((e) => e.introduced)?.introduced;
  const fixed = events.find((e) => e.fixed)?.fixed;
  if (intro && fixed) return `>= ${intro} < ${fixed}`;
  if (fixed) return `< ${fixed}`;
  if (intro) return `>= ${intro}`;
  return undefined;
}

/**
 * Osv scanner class.
 */
export class OsvScanner implements ScannerEngine {
  readonly name = "osv";

  private readonly concurrencyLimit: number;

  constructor(concurrencyLimit = 10) {
    this.concurrencyLimit = concurrencyLimit;
  }

  /**
   * Supports.
   *
   * @param context - Context
   * @returns Supports result
   */
  supports(context: ScanContext): boolean {
    const pkgPath = path.join(context.projectPath, "package.json");
    return fs.existsSync(pkgPath);
  }

  /**
   * Scan.
   *
   * @param context - Context
   * @returns Scan result
   */
  async scan(context: ScanContext): Promise<ScanResult> {
    const pkgPath = path.join(context.projectPath, "package.json");
    if (!fs.existsSync(pkgPath)) {
      return {
        scanner: this.name,
        status: "success",
        findings: [],
      };
    }

    let packageJson: {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
    };

    try {
      packageJson = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    } catch {
      return {
        scanner: this.name,
        status: "failed",
        findings: [],
        error: "Failed to parse package.json for dependency scanning.",
      };
    }

    const depTypes: Array<{ type: DependencyType; deps: Record<string, string> }> = [
      { type: "dependencies", deps: context.dependencies ?? packageJson.dependencies ?? {} },
      { type: "devDependencies", deps: context.devDependencies ?? packageJson.devDependencies ?? {} },
      { type: "peerDependencies", deps: packageJson.peerDependencies ?? {} },
      { type: "optionalDependencies", deps: packageJson.optionalDependencies ?? {} },
    ];

    const packageMap = new Map<string, { declaredVersion: string; dependencyType: DependencyType }>();
    for (const { type, deps } of depTypes) {
      for (const [name, version] of Object.entries(deps)) {
        if (!packageMap.has(name)) {
          packageMap.set(name, { declaredVersion: version, dependencyType: type });
        }
      }
    }

    if (packageMap.size === 0) {
      return {
        scanner: this.name,
        status: "success",
        findings: [],
      };
    }

    const packagesToScan: PackageToScan[] = Array.from(packageMap.entries()).map(
      ([name, meta]) => {
        const declaredVersion = nonEmpty(meta.declaredVersion, "latest");
        let installedVersion = declaredVersion.replace(/[\^~]/g, "");

        const installedPkgPath = path.join(
          context.projectPath,
          "node_modules",
          name,
          "package.json"
        );

        if (fs.existsSync(installedPkgPath)) {
          try {
            const installedJson = JSON.parse(
              fs.readFileSync(installedPkgPath, "utf8")
            );
            if (installedJson.version) {
              installedVersion = installedJson.version;
            }
          } catch {
            // Fall back to clean declared version
          }
        }

        return {
          name,
          declaredVersion,
          installedVersion,
          dependencyType: meta.dependencyType,
        };
      }
    );

    const findings: ScanIssueInput[] = [];
    let hasNetworkErrors = false;
    let hasTimeouts = false;
    let successfulQueries = 0;
    let skippedQueries = 0;
    const diagnostics: string[] = [];

    // Concurrency-limited execution
    await this.runWithConcurrency(
      packagesToScan,
      this.concurrencyLimit,
      async (pkg) => {
        if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(pkg.installedVersion)) {
          skippedQueries += 1;
          diagnostics.push(
            `Skipped ${pkg.name}: '${pkg.declaredVersion}' did not resolve to an exact installed version.`
          );
          return;
        }

        const queryResult = await queryOsv(pkg.name, pkg.installedVersion);

        if (queryResult.status === "timeout") {
          hasTimeouts = true;
          diagnostics.push(`OSV query timed out for ${pkg.name}@${pkg.installedVersion}.`);
          return;
        }

        if (queryResult.status === "unavailable" || queryResult.status === "error") {
          hasNetworkErrors = true;
          diagnostics.push(`OSV query failed for ${pkg.name}@${pkg.installedVersion}: ${queryResult.error}`);
          return;
        }

        successfulQueries += 1;

        const vulns = queryResult.data.vulns ?? [];
        if (vulns.length > 0) {
          const allFixedVersions = this.extractAllFixedVersions(vulns);
          const affectedRanges = this.extractAffectedRanges(vulns);

          findings.push({
            id: `osv-${pkg.name}`,
            title: `Dependency Problem: ${pkg.name}`,
            message: `Package '${pkg.name}' (${pkg.installedVersion}) has ${vulns.length} known ${vulns.length > 1 ? "vulnerabilities" : "vulnerability"}.`,
            severity: "high",
            category: "security",
            source: this.name,
            confidence: "confirmed",
            key: pkg.name,
            file: "package.json",
            evidence: `Installed: ${pkg.installedVersion}, Declared: ${pkg.declaredVersion}`,
            // Do NOT generate pre-cooked remediation string. ResolutionEngine decides which resolution plans are valid.
            dependencyProblem: {
              package: pkg.name,
              installedVersion: pkg.installedVersion,
              declaredVersion: pkg.declaredVersion,
              dependencyType: pkg.dependencyType,
              advisoryCount: vulns.length,
              advisories: vulns.map((v) => ({
                id: v.id,
                summary: v.summary,
                details: v.details,
                ranges: v.affected?.flatMap((a) => a.ranges ?? []) ?? [],
              })),
              affectedRanges,
              fixedVersions: allFixedVersions,
              resolutionMetadata: {
                ecosystem: "npm",
                source: this.name,
              },
            },
          });
        }
      }
    );

    if (hasNetworkErrors || hasTimeouts || skippedQueries > 0) {
      return {
        scanner: this.name,
        status: successfulQueries > 0 ? "partial" : "failed",
        findings: findings.sort((a, b) => a.id.localeCompare(b.id)).map(createScanIssue),
        error: "One or more dependencies could not be verified by OSV.",
        diagnostics: diagnostics.sort(),
      };
    }

    return {
      scanner: this.name,
      status: "success",
      findings: findings.sort((a, b) => a.id.localeCompare(b.id)).map(createScanIssue),
    };
  }

  private extractAllFixedVersions(vulns: OsvVulnerability[]): string[] {
    const fixedSet = new Set<string>();
    for (const events of eventLists(vulns)) {
      for (const event of events) {
        if (event.fixed && !PRERELEASE_MARKERS.some((marker) => event.fixed?.includes(marker))) {
          fixedSet.add(event.fixed);
        }
      }
    }
    return Array.from(fixedSet).sort(compareVersions);
  }

  private extractAffectedRanges(vulns: OsvVulnerability[]): string[] {
    const ranges: string[] = [];
    for (const events of eventLists(vulns)) {
      const range = describeRange(events);
      if (range) ranges.push(range);
    }
    return Array.from(new Set(ranges));
  }

  private async runWithConcurrency<T, R>(
    items: T[],
    limit: number,
    fn: (item: T) => Promise<R>
  ): Promise<R[]> {
    const results: R[] = [];
    let index = 0;

    const worker = async () => {
      while (index < items.length) {
        const currentIndex = index++;
        const item = items[currentIndex];
        if (item !== undefined) {
          results[currentIndex] = await fn(item);
        }
      }
    };

    const workerCount = Math.min(limit, items.length);
    const workers = Array.from({ length: workerCount }, () => worker());
    await Promise.all(workers);
    return results;
  }
}
