import { readFileSync, existsSync } from "fs";
import { join } from "path";
import semver from "semver";
import { BaseGuard } from "./base-guard.js";
import type { AuditResult, AuditIssue, AuditContext } from "./types.js";
import { CompatibilityEngine } from "../scan/scanners/compatibility/compatibility-engine.js";
import { enrichIssue } from "../scan/bridge.js";
import { nonEmpty } from "../utils/defaults.js";

/** A single structured compatibility finding. */
export interface CompatibilityFinding {
  /** Stable issue code, e.g. COMPATIBILITY_EOL_NODE. */
  code: string;
  /** Severity: errors make the project incompatible, warnings do not. */
  severity: "error" | "warning";
  /** Human readable description (same text as the matching `issues` entry). */
  message: string;
}

/** Result of a compatibility audit of a project's package.json. */
export interface CompatibilityAuditResult {
  /** False when an error-level finding (EOL runtime, peer conflict, unreadable package.json) exists. */
  isCompatible: boolean;
  /** Human readable report lines. */
  reports: string[];
  /** Human readable issue messages (one per finding). */
  issues: string[];
  /** Structured findings with code and severity. */
  findings: CompatibilityFinding[];
}

/** Oldest Node.js major version that is still supported; anything lower is end-of-life. */
const MIN_SUPPORTED_NODE_MAJOR = 18;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Keep only the string-valued entries of a dependency map. */
function toStringMap(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!isRecord(value)) return out;
  for (const [key, spec] of Object.entries(value)) {
    if (typeof spec === "string") out[key] = spec;
  }
  return out;
}

/**
 * Lowest version a semver range admits, or undefined when the spec is not a
 * bounded semver range (git/file/workspace/alias specs, dist-tags, `*`, `<=x`).
 */
function minimumVersion(spec: string): semver.SemVer | undefined {
  const range = semver.validRange(spec);
  if (range === null || range === "*") return undefined;
  try {
    const min = semver.minVersion(range);
    if (min === null) return undefined;
    if (min.major === 0 && min.minor === 0 && min.patch === 0 && !/\d/.test(spec)) {
      return undefined;
    }
    return min;
  } catch {
    return undefined;
  }
}

function performCompatibilityAuditInternal(
  projectRoot?: string
): CompatibilityAuditResult {
  const root = nonEmpty(projectRoot, process.cwd());
  const packageJsonPath = join(root, "package.json");

  const reports: string[] = [];
  const issues: string[] = [];
  const findings: CompatibilityFinding[] = [];
  const add = (
    code: string,
    severity: CompatibilityFinding["severity"],
    message: string
  ): void => {
    findings.push({ code, severity, message });
    issues.push(message);
  };
  const finish = (): CompatibilityAuditResult => {
    const isCompatible = !findings.some((f) => f.severity === "error");
    if (isCompatible && reports.length === 0) {
      reports.push("✅ All dependencies are compatible and well-maintained");
    }
    return { isCompatible, reports, issues, findings };
  };

  if (!existsSync(packageJsonPath)) {
    reports.push("ℹ️ No package.json found. Skipping compatibility checks.");
    return finish();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
  } catch {
    reports.push("❌ Failed to parse package.json");
    add(
      "COMPATIBILITY_PACKAGE_JSON_INVALID",
      "error",
      "package.json could not be read or parsed as JSON"
    );
    return finish();
  }
  if (!isRecord(parsed)) {
    reports.push("❌ Failed to parse package.json: expected a JSON object");
    add(
      "COMPATIBILITY_PACKAGE_JSON_INVALID",
      "error",
      "package.json must contain a JSON object"
    );
    return finish();
  }

  // Node.js engine range
  const engines = parsed["engines"];
  const nodeRange = isRecord(engines) ? engines["node"] : undefined;
  if (typeof nodeRange === "string") {
    const min = minimumVersion(nodeRange);
    if (min !== undefined && min.major < MIN_SUPPORTED_NODE_MAJOR) {
      add(
        "COMPATIBILITY_EOL_NODE",
        "error",
        `Node.js ${nodeRange} is end-of-life. Upgrade to ${supportedNodeVersions.join(" or ")}`
      );
      reports.push(`🔴 EOL Node.js version detected: ${nodeRange}`);
    } else if (min === undefined && semver.validRange(nodeRange) === null) {
      reports.push(`ℹ️ Could not parse engines.node range: ${nodeRange}`);
    }
  }

  const dependencies = toStringMap(parsed["dependencies"]);
  const devDependencies = toStringMap(parsed["devDependencies"]);
  const optionalDependencies = toStringMap(parsed["optionalDependencies"]);
  const peerDependencies = toStringMap(parsed["peerDependencies"]);

  // Deprecated packages
  const names = new Set([
    ...Object.keys(dependencies),
    ...Object.keys(devDependencies),
    ...Object.keys(optionalDependencies),
    ...Object.keys(peerDependencies),
  ]);
  for (const pkg of names) {
    const entry = Object.hasOwn(deprecatedPackages, pkg)
      ? deprecatedPackages[pkg]
      : undefined;
    if (entry) {
      add(
        "COMPATIBILITY_DEPRECATED_PACKAGE",
        "warning",
        `Package '${pkg}' is deprecated. Consider ${entry.alternative} instead. ${entry.reason}`
      );
      reports.push(`⚠️ Deprecated package: ${pkg}`);
    }
  }

  // Peer dependency conflicts: compare what is actually installed with the peer range
  const installed: Record<string, string> = {
    ...optionalDependencies,
    ...devDependencies,
    ...dependencies,
  };
  for (const [peerPkg, peerRange] of Object.entries(peerDependencies)) {
    const installedSpec = Object.hasOwn(installed, peerPkg)
      ? installed[peerPkg]
      : undefined;
    if (installedSpec === undefined) continue;
    if (semver.validRange(peerRange) === null) continue;
    const min = minimumVersion(installedSpec);
    if (min === undefined) continue;
    if (!semver.satisfies(min, peerRange, { includePrerelease: true })) {
      add(
        "COMPATIBILITY_PEER_CONFLICT",
        "error",
        `Peer dependency mismatch: ${peerPkg} requires ${peerRange} but ${installedSpec} is installed`
      );
      reports.push(
        `❌ Peer dependency conflict: ${peerPkg} (required: ${peerRange}, installed: ${installedSpec})`
      );
    }
  }

  return finish();
}

/**
 * Audit a project's package.json for EOL Node.js engines, deprecated packages and peer dependency conflicts.
 *
 * @param projectRoot - Project directory (defaults to the current working directory)
 * @returns Audit result with reports, issue messages and structured findings
 */
export { performCompatibilityAuditInternal as performCompatibilityAudit };

/**
 * Validates dependency compatibility: Node.js engine ranges, end-of-life runtimes and peer dependencies.
 * Severity levels used: error.
 */
export class CompatibilityGuard extends BaseGuard {
  private projectRoot?: string | undefined;

  constructor(projectRoot?: string, context?: AuditContext) {
    super("compatibility-guard", context);
    this.projectRoot = projectRoot;
  }

  /**
   * Execute.
   *
   * @returns Execute result
   */
  async execute(): Promise<AuditResult> {
    const root = nonEmpty(this.projectRoot, process.cwd());
    const result = performCompatibilityAuditInternal(root);
    const auditIssues: AuditIssue[] = result.findings.map((finding) =>
      this.createIssue(
        finding.code,
        finding.severity,
        finding.severity === "error" ? "Compatibility Issue" : "Compatibility Warning",
        finding.message,
        undefined,
        "Review and update dependencies to supported versions",
        ["compatibility", "dependency"]
      )
    );

    // Cross-package rules (e.g. Next.js x React 19) come from the scan layer's CompatibilityEngine
    let scanFound = false;
    try {
      const engine = new CompatibilityEngine();
      const scanContext = { projectPath: root, files: [] as string[] };
      if (engine.supports(scanContext)) {
        const scan = await engine.scan(scanContext);
        const scanIssues = scan.findings.map(enrichIssue);
        scanFound = scanIssues.length > 0;
        auditIssues.push(...scanIssues);
      }
    } catch (error) {
      auditIssues.push(
        this.createIssue(
          "COMPATIBILITY_SCAN_FAILED",
          "error",
          "Compatibility Scan Failed",
          `Cross-package compatibility scan failed: ${error instanceof Error ? error.message : String(error)}`,
          undefined,
          "Check that package.json is readable and valid",
          ["compatibility", "scan"]
        )
      );
    }

    if (auditIssues.length === 0) {
      return this.ok("✅ All dependencies compatible");
    }
    const message = `❌ ${auditIssues.length} compatibility issues found`;
    // Cross-package rule hits have always produced an "issues" status; keep that.
    if (scanFound) return this.createResult("issues", auditIssues, message);
    return this.issues(auditIssues, message);
  }
}
