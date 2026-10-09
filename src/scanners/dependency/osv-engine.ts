/**
 * OSV Dependency Scanner Engine
 * Scans npm dependencies for known vulnerabilities using the OSV API.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { BaseGuard } from "../../core/base-guard.js";
import type { AuditResult, AuditIssue, AuditContext } from "../../core/types.js";
import { OSVClient, type OSVQueryRequest, type OSVVulnerability } from "./osv-client.js";

interface PackageLockEntry {
  version?: string;
  resolved?: string;
  dependencies?: Record<string, PackageLockEntry>;
}

interface PackageLock {
  packages: Record<string, PackageLockEntry>;
  dependencies?: Record<string, PackageLockEntry>;
}

interface OSVScanOptions {
  projectRoot: string;
  includeDevDependencies?: boolean;
  ignorePackages?: string[];
}

function readPackageJson(projectRoot: string): Record<string, string> {
  try {
    const content = readFileSync(join(projectRoot, "package.json"), "utf-8");
    const pkg = JSON.parse(content) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return {
      ...pkg.dependencies,
    };
  } catch {
    return {};
  }
}

function readPackageLock(projectRoot: string): PackageLock {
  try {
    const content = readFileSync(join(projectRoot, "package-lock.json"), "utf-8");
    return JSON.parse(content) as PackageLock;
  } catch {
    return { packages: {} };
  }
}

function extractVersionFromLock(
  lock: PackageLock,
  packageName: string
): string | undefined {
  const packages = lock.packages || {};

  for (const [key, entry] of Object.entries(packages)) {
    if (key === `node_modules/${packageName}` || key.endsWith(`/${packageName}`)) {
      return entry.version;
    }
  }

  return undefined;
}

export class OSVGuard extends BaseGuard {
  private options: OSVScanOptions;
  private osvClient: OSVClient;

  constructor(options: OSVScanOptions, context?: AuditContext) {
    super("osv-dependency-guard", context);
    this.options = {
      includeDevDependencies: false,
      ignorePackages: [],
      ...options,
    };
    this.osvClient = new OSVClient();
  }

  async execute(): Promise<AuditResult> {
    try {
      const packageJson = readPackageJson(this.options.projectRoot);
      const packageLock = readPackageLock(this.options.projectRoot);

      if (Object.keys(packageJson).length === 0) {
        return this.ok("No dependencies found in package.json");
      }

      const queryRequests = this.buildQueryRequests(
        packageJson,
        packageLock
      );

      const vulnerabilities = await this.osvClient.queryBatch(queryRequests);
      const issues = this.createIssuesFromVulnerabilities(vulnerabilities);

      if (issues.length === 0) {
        return this.ok("No known vulnerabilities found in dependencies");
      }

      return this.issues(issues, `Found ${issues.length} vulnerability(ies) in dependencies`);
    } catch (error) {
      return this.createErrorResult(error);
    }
  }

  private buildQueryRequests(
    packages: Record<string, string>,
    packageLock: PackageLock
  ): OSVQueryRequest[] {
    const requests: OSVQueryRequest[] = [];

    for (const [packageName, _version] of Object.entries(packages)) {
      if (this.options.ignorePackages?.includes(packageName)) {
        continue;
      }

      const lockedVersion = extractVersionFromLock(packageLock, packageName);
      const version = lockedVersion || "latest";

      requests.push({
        package: {
          ecosystem: "npm",
          name: packageName,
        },
        version,
      });
    }

    return requests;
  }

  private createIssuesFromVulnerabilities(
    vulnerabilityMap: Map<string, OSVVulnerability[]>
  ): AuditIssue[] {
    const issues: AuditIssue[] = [];

    for (const [packageKey, vulns] of vulnerabilityMap.entries()) {
      for (const vuln of vulns) {
        const severity = this.determineSeverity(vuln);
        const issue: AuditIssue = {
          code: `OSV_${vuln.id}`,
          severity,
          title: `Vulnerability in ${packageKey}`,
          message: vuln.summary || `Security vulnerability: ${vuln.id}`,
          location: {
            file: "package.json",
          },
          recommendation: this.getRecommendation(vuln),
          tags: ["dependency", "security", "osv", vuln.id],
        };
        issues.push(issue);
      }
    }

    return issues;
  }

  private determineSeverity(
    vuln: OSVVulnerability
  ): AuditIssue["severity"] {
    if (this.osvClient.isCritical(vuln)) {
      return "critical";
    }
    if (this.osvClient.isHighSeverity(vuln)) {
      return "error";
    }
    return "warning";
  }

  private getRecommendation(vuln: OSVVulnerability): string {
    const affected = vuln.affected?.[0];
    if (!affected) {
      return "Review vulnerability and update package";
    }

    const ranges = affected.ranges || [];
    for (const range of ranges) {
      for (const event of range.events || []) {
        if (event.fixed) {
          return `Update ${affected.package.name} to version ${event.fixed} or later`;
        }
      }
    }

    return "Update package to latest version";
  }
}

export async function performOSVScan(options: OSVScanOptions): Promise<AuditResult> {
  const guard = new OSVGuard(options);
  return guard.run();
}
