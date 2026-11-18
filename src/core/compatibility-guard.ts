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

/** What one check contributes: structured findings plus human readable report lines. */
interface CheckOutput {
  findings: CompatibilityFinding[];
  reports: string[];
}

/** Flags an end-of-life `engines.node` range, or notes one that cannot be parsed. */
function checkNodeEngine(parsed: Record<string, unknown>): CheckOutput {
  const out: CheckOutput = { findings: [], reports: [] };
  const engines = parsed["engines"];
  const nodeRange = isRecord(engines) ? engines["node"] : undefined;
  if (typeof nodeRange !== "string") return out;

  const min = minimumVersion(nodeRange);
  if (min !== undefined && min.major < MIN_SUPPORTED_NODE_MAJOR) {
    out.findings.push({
      code: "COMPATIBILITY_EOL_NODE",
      severity: "error",
      message: `Node.js ${nodeRange} is end-of-life. Upgrade to ${supportedNodeVersions.join(" or ")}`,
    });
    out.reports.push(`🔴 EOL Node.js version detected: ${nodeRange}`);
  } else if (min === undefined && semver.validRange(nodeRange) === null) {
    out.reports.push(`ℹ️ Could not parse engines.node range: ${nodeRange}`);
  }
  return out;
}

/** Flags every declared package (any dependency section) that has a known better alternative. */
function checkDeprecatedPackages(names: Iterable<string>): CheckOutput {
  const out: CheckOutput = { findings: [], reports: [] };
  for (const pkg of names) {
    const entry = Object.hasOwn(deprecatedPackages, pkg) ? deprecatedPackages[pkg] : undefined;
    if (entry === undefined) continue;
    out.findings.push({
      code: "COMPATIBILITY_DEPRECATED_PACKAGE",
      severity: "warning",
      message: `Package '${pkg}' is deprecated. Consider ${entry.alternative} instead. ${entry.reason}`,
    });
    out.reports.push(`⚠️ Deprecated package: ${pkg}`);
  }
  return out;
}

/** Compares what is actually installed with each peer range; unbounded or unparsable specs are skipped. */
function checkPeerConflicts(
  peerDependencies: Record<string, string>,
  installed: Record<string, string>
): CheckOutput {
  const out: CheckOutput = { findings: [], reports: [] };
  for (const [peerPkg, peerRange] of Object.entries(peerDependencies)) {
    const installedSpec = Object.hasOwn(installed, peerPkg) ? installed[peerPkg] : undefined;
    if (installedSpec === undefined || semver.validRange(peerRange) === null) continue;
    const min = minimumVersion(installedSpec);
    if (min === undefined || semver.satisfies(min, peerRange, { includePrerelease: true })) continue;
    out.findings.push({
      code: "COMPATIBILITY_PEER_CONFLICT",
      severity: "error",
      message: `Peer dependency mismatch: ${peerPkg} requires ${peerRange} but ${installedSpec} is installed`,
    });
    out.reports.push(`❌ Peer dependency conflict: ${peerPkg} (required: ${peerRange}, installed: ${installedSpec})`);
  }
  return out;
}

/** Builds the final result; a clean, non-empty audit gets a single success line. */
function finishAudit(findings: CompatibilityFinding[], reports: string[]): CompatibilityAuditResult {
  const isCompatible = !findings.some((f) => f.severity === "error");
  if (isCompatible && reports.length === 0) {
    reports.push("✅ All dependencies are compatible and well-maintained");
  }
  return { isCompatible, reports, issues: findings.map((f) => f.message), findings };
}

/** Result for a package.json that cannot be used: one error finding and its report line. */
function invalidPackageJson(report: string, message: string): CompatibilityAuditResult {
  return finishAudit(
    [{ code: "COMPATIBILITY_PACKAGE_JSON_INVALID", severity: "error", message }],
    [report]
  );
}

function performCompatibilityAuditInternal(
  projectRoot?: string
): CompatibilityAuditResult {
  const packageJsonPath = join(nonEmpty(projectRoot, process.cwd()), "package.json");

  if (!existsSync(packageJsonPath)) {
    return finishAudit([], ["ℹ️ No package.json found. Skipping compatibility checks."]);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
  } catch {
    return invalidPackageJson("❌ Failed to parse package.json", "package.json could not be read or parsed as JSON");
  }
  if (!isRecord(parsed)) {
    return invalidPackageJson(
      "❌ Failed to parse package.json: expected a JSON object",
      "package.json must contain a JSON object"
    );
  }

  const dependencies = toStringMap(parsed["dependencies"]);
  const devDependencies = toStringMap(parsed["devDependencies"]);
  const optionalDependencies = toStringMap(parsed["optionalDependencies"]);
  const peerDependencies = toStringMap(parsed["peerDependencies"]);

  const names = new Set([
    ...Object.keys(dependencies),
    ...Object.keys(devDependencies),
    ...Object.keys(optionalDependencies),
    ...Object.keys(peerDependencies),
  ]);
  // Peer ranges are checked against what is installed; `dependencies` wins over dev over optional.
  const installed = { ...optionalDependencies, ...devDependencies, ...dependencies };

  const outputs = [
    checkNodeEngine(parsed),
    checkDeprecatedPackages(names),
    checkPeerConflicts(peerDependencies, installed),
  ];
  return finishAudit(
    outputs.flatMap((o) => o.findings),
    outputs.flatMap((o) => o.reports)
  );
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
   * Cross-package rules (e.g. Next.js x React 19) from the scan layer's CompatibilityEngine.
   * A crash of the engine is reported as an issue, never thrown.
   *
   * @param root - Project directory to scan
   * @returns The issues found and whether any came from a cross-package rule
   */
  private async scanCrossPackage(root: string): Promise<{ issues: AuditIssue[]; found: boolean }> {
    try {
      const engine = new CompatibilityEngine();
      const scanContext = { projectPath: root, files: [] as string[] };
      if (!engine.supports(scanContext)) return { issues: [], found: false };
      const scan = await engine.scan(scanContext);
      const issues = scan.findings.map(enrichIssue);
      return { issues, found: issues.length > 0 };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const issue = this.createIssue(
        "COMPATIBILITY_SCAN_FAILED",
        "error",
        "Compatibility Scan Failed",
        `Cross-package compatibility scan failed: ${reason}`,
        undefined,
        "Check that package.json is readable and valid",
        ["compatibility", "scan"]
      );
      return { issues: [issue], found: false };
    }
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

    const scan = await this.scanCrossPackage(root);
    auditIssues.push(...scan.issues);
    const scanFound = scan.found;

    if (auditIssues.length === 0) {
      return this.ok("✅ All dependencies compatible");
    }
    const message = `❌ ${auditIssues.length} compatibility issues found`;
    // Cross-package rule hits have always produced an "issues" status; keep that.
    if (scanFound) return this.createResult("issues", auditIssues, message);
    return this.issues(auditIssues, message);
  }
}
