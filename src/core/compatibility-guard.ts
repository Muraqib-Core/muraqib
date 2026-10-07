import { readFileSync, existsSync } from "fs";
import { join } from "path";

export interface CompatibilityAuditResult {
  isCompatible: boolean;
  reports: string[];
  issues: string[];
}

const nodeEOLVersions = ["14", "16"];
const supportedNodeVersions = ["18", "20", "22"];

const deprecatedPackages: Record<
  string,
  { alternative: string; reason: string }
> = {
  "node-fetch": {
    alternative: "Built-in fetch (Node 18+)",
    reason: "Native fetch is available in modern Node.js",
  },
  uuid: {
    alternative: "crypto.randomUUID() for native support",
    reason: "Built-in crypto provides UUID generation",
  },
};

export function performCompatibilityAudit(
  projectRoot?: string
): CompatibilityAuditResult {
  const root = projectRoot || process.cwd();
  const packageJsonPath = join(root, "package.json");

  const reports: string[] = [];
  const issues: string[] = [];
  let isCompatible = true;

  if (!existsSync(packageJsonPath)) {
    reports.push("ℹ️ No package.json found. Skipping compatibility checks.");
    return { isCompatible, reports, issues };
  }

  let packageJson;
  try {
    packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
  } catch {
    reports.push("❌ Failed to parse package.json");
    return { isCompatible: false, reports, issues };
  }

  // Check Node.js version engines
  if (packageJson.engines?.node) {
    const nodeVersion = packageJson.engines.node;
    const isEOL = nodeEOLVersions.some((v) => nodeVersion.includes(v));

    if (isEOL) {
      issues.push(
        `Node.js ${nodeVersion} is end-of-life. Upgrade to ${supportedNodeVersions.join(" or ")}`
      );
      reports.push(`🔴 EOL Node.js version detected: ${nodeVersion}`);
      isCompatible = false;
    }
  }

  // Check dependencies
  const allDeps = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
    ...packageJson.peerDependencies,
  };

  for (const [pkg] of Object.entries(allDeps)) {
    if (deprecatedPackages[pkg]) {
      const { alternative, reason } = deprecatedPackages[pkg];
      issues.push(
        `Package '${pkg}' is deprecated. Consider ${alternative} instead. ${reason}`
      );
      reports.push(`⚠️ Deprecated package: ${pkg}`);
    }
  }

  // Check peer dependency conflicts
  if (packageJson.peerDependencies) {
    for (const [peerPkg, peerVersion] of Object.entries(
      packageJson.peerDependencies
    )) {
      const installedVersion = allDeps[peerPkg];
      if (
        installedVersion &&
        installedVersion !== peerVersion &&
        !new RegExp(peerVersion as string).test(installedVersion as string)
      ) {
        issues.push(
          `Peer dependency mismatch: ${peerPkg} requires ${peerVersion} but ${installedVersion} is installed`
        );
        reports.push(
          `❌ Peer dependency conflict: ${peerPkg} (required: ${peerVersion}, installed: ${installedVersion})`
        );
        isCompatible = false;
      }
    }
  }

  if (isCompatible && reports.length === 0) {
    reports.push("✅ All dependencies are compatible and well-maintained");
  }

  return { isCompatible, reports, issues };
}
