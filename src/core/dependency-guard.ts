/*
### 🔍 Dependency & Architecture Auditor (`dependency-audit.ts`)

An advanced auditing utility designed to analyze project source code dependencies, detect structural issues, and ensure code health by scanning TypeScript/JavaScript files.

#### Key Features:
* **Deprecated API Detection:** Scans codebase for obsolete or deprecated APIs (e.g., `url.parse`, `fs.exists`, `__dirname` in ESM) and suggests modern alternatives.
* **Circular Dependency Detection:** Builds a file relationship graph and runs a Depth-First Search (DFS) algorithm to locate cyclic module imports.
* **Version & Lockfile Inspection:** Scans lock files (`package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`) for duplicate package versions.
*/
import fs from "fs";
import path from "path";
import { scanProjectFiles } from "../utils/file-scanner.js";
import { maskLiteralsAndComments } from "../utils/code-mask.js";
import { BaseGuard } from "./base-guard.js";
import { extractImportSpecifiers, findCycles, resolveImportTarget } from "./helpers/import-graph.js";
import {
  collectNpmLockVersions,
  collectPnpmLockVersions,
  collectYarnLockVersions,
  findDuplicateVersions,
} from "./helpers/lockfile-duplicates.js";
import type { PackageVersions } from "./helpers/lockfile-duplicates.js";
import type { AuditResult, AuditIssue, AuditContext } from "./types.js";

/** Stable machine-readable codes for dependency findings. */
type DependencyFindingCode = "DEPENDENCY_CIRCULAR" | "DEPENDENCY_DEPRECATED_API" | "DEPENDENCY_DUPLICATE_PACKAGE";

/** One structured dependency finding (mirrors an entry of `reports`). */
interface DependencyFinding {
  code: DependencyFindingCode;
  severity: "error" | "warning";
  message: string;
  file?: string;
}

export interface DependencyAuditResult { // muraqib-ignore-dead: auto-suppressed by script for DependencyAuditResult
  isClean: boolean;
  reports: string[];
  circularDependencies: string[][];
  outdatedPackages: string[];
  duplicatePackages: string[];
  deprecatedImports: string[];
  /** Structured findings with stable codes; one per entry of `reports`. */
  findings: DependencyFinding[];
}

interface DependencyAuditOptions {
  targetPath: string;
}

interface DeprecatedPattern {
  id: string;
  pattern: RegExp;
  suggestion: string;
  /** Module specifiers whose import is itself deprecated (checked on the unmasked specifier list). */
  modules?: readonly string[];
}

const DEPRECATED_PATTERNS: DeprecatedPattern[] = [
  { id: "url.parse", pattern: /(?<![.\w$])url\.parse\b/, suggestion: "Use new URL() constructor instead" },
  {
    id: "querystring",
    pattern: /(?<![.\w$])querystring\.(?:parse|stringify|escape|unescape)\b/,
    suggestion: "Use URLSearchParams instead",
    modules: ["querystring", "node:querystring"],
  },
  { id: "createDecipher", pattern: /\bcrypto\.createDecipher\b/, suggestion: "Use crypto.createDecipheriv instead" },
  { id: "new-buffer", pattern: /\bnew\s+Buffer\s*\(/, suggestion: "Use Buffer.from() or Buffer.alloc() explicitly" },
  {
    id: "buffer-call",
    pattern: /(?<!\bnew\s+)(?<![.\w$])\bBuffer\s*\(/,
    suggestion: "Avoid calling Buffer() as a function; use Buffer.from/alloc",
  },
  { id: "fs.exists", pattern: /\bfs\.exists\s*\(/, suggestion: "Use fs.existsSync or fs.promises.access instead" },
  { id: "process.binding", pattern: /\bprocess\.binding\b/, suggestion: "Deprecated internal API" },
  { id: "dirname", pattern: /__dirname\b/, suggestion: "Use import.meta.url with fileURLToPath instead (ESM)" },
  { id: "require", pattern: /(?<![.\w$])require\s*\(/, suggestion: "Use dynamic import() instead (ESM)" },
];

/** Directory names whose contents are build output or vendored code. */
const GENERATED_SEGMENTS: ReadonlySet<string> = new Set([
  "dist",
  "build",
  "coverage",
  "node_modules",
  "generated",
  ".next",
  "out",
]);

/** Directories where CommonJS `require()` is acceptable. */
const REQUIRE_ALLOWED_SEGMENTS: ReadonlySet<string> = new Set(["scripts", "config", "tests"]);

const LOCK_FILES: ReadonlyArray<{ name: string; collect: (content: string, into: PackageVersions) => void }> = [
  { name: "package-lock.json", collect: collectNpmLockVersions },
  { name: "yarn.lock", collect: collectYarnLockVersions },
  { name: "pnpm-lock.yaml", collect: collectPnpmLockVersions },
];

function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}

/** True when a path lies in a build-output directory or is a declaration file (whole segments only). */
function isGeneratedPath(posixPath: string): boolean {
  const segments = posixPath.split("/");
  const fileName = segments.pop() ?? "";
  return fileName.endsWith(".d.ts") || segments.some((segment) => GENERATED_SEGMENTS.has(segment));
}

function isRequireAllowed(posixPath: string): boolean {
  if (/^src\/index\.[cm]?[jt]s$/.test(posixPath)) return true;
  return posixPath.split("/").slice(0, -1).some((segment) => REQUIRE_ALLOWED_SEGMENTS.has(segment));
}

function readTextFile(filePath: string): string | undefined {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return undefined;
  }
}

function performDependencyAuditInternal(targetPath: string): DependencyAuditResult {
  const reports: string[] = [];
  const findings: DependencyFinding[] = [];
  const outdatedPackages: string[] = [];
  const duplicatePackages: string[] = [];
  const deprecatedImports: string[] = [];

  const scannedFiles = scanProjectFiles(targetPath, ["ts", "js"]);

  // Graph keys are the scanner's relativePath (normalised to "/"), so edges and nodes connect.
  const analysed = scannedFiles
    .map((file) => ({ ...file, posix: toPosix(file.relativePath) }))
    .filter(
      (file) =>
        !isGeneratedPath(file.posix) &&
        // Avoid scanning this auditor so its own pattern definitions are not self-matched.
        file.posix !== "src/core/dependency-guard.ts"
    );

  const relativeByAbsolute = new Map<string, string>();
  for (const file of analysed) {
    relativeByAbsolute.set(path.normalize(file.path), file.posix);
  }

  const graph: Map<string, Set<string>> = new Map();

  for (const file of analysed) {
    const edges = new Set<string>();
    graph.set(file.posix, edges);

    const specifiers = extractImportSpecifiers(file.content);
    for (const specifier of specifiers) {
      const resolved = resolveImportTarget(file.path, specifier, (candidate) =>
        relativeByAbsolute.has(path.normalize(candidate))
      );
      const target = resolved === undefined ? undefined : relativeByAbsolute.get(path.normalize(resolved));
      if (target !== undefined) edges.add(target);
    }

    const maskedContent = maskLiteralsAndComments(file.content);
    for (const dp of DEPRECATED_PATTERNS) {
      const matchesCode = dp.pattern.test(maskedContent);
      const matchesModule = dp.modules?.some((moduleName) => specifiers.includes(moduleName)) ?? false;
      if (!matchesCode && !matchesModule) continue;
      if (dp.id === "require" && isRequireAllowed(file.posix)) continue;

      const message = `Deprecated API usage in ${file.posix}: ${dp.pattern} -> ${dp.suggestion}`;
      deprecatedImports.push(message);
      reports.push(message);
      findings.push({ code: "DEPENDENCY_DEPRECATED_API", severity: "warning", message, file: file.posix });
    }
  }

  const circularDependencies = findCycles(graph);
  for (const cycle of circularDependencies) {
    const message = `Circular dependency detected: ${cycle.join(" \u2192 ")}`;
    reports.push(message);
    const first = cycle[0];
    findings.push({
      code: "DEPENDENCY_CIRCULAR",
      severity: "error",
      message,
      ...(first === undefined ? {} : { file: first }),
    });
  }

  // Check lock files for duplicate package versions. A 0.x version is not "outdated" per se,
  // and without network access we cannot know about newer majors, so no version heuristic runs here.
  if (fs.existsSync(path.join(targetPath, "package.json"))) {
    const versions: PackageVersions = new Map();
    const lockFilesUsed: string[] = [];
    for (const lock of LOCK_FILES) {
      const content = readTextFile(path.join(targetPath, lock.name));
      if (content === undefined) continue;
      lockFilesUsed.push(lock.name);
      lock.collect(content, versions);
    }

    for (const duplicate of findDuplicateVersions(versions)) {
      const count = duplicate.versions.length;
      duplicatePackages.push(`${duplicate.name} (${count} versions in lock file: ${duplicate.versions.join(", ")})`);
      const message = `Duplicate package versions: ${duplicate.name} appears ${count} times (${duplicate.versions.join(", ")})`;
      reports.push(message);
      findings.push({
        code: "DEPENDENCY_DUPLICATE_PACKAGE",
        severity: "warning",
        message,
        ...(lockFilesUsed[0] === undefined ? {} : { file: lockFilesUsed[0] }),
      });
    }
  }

  return {
    isClean: reports.length === 0,
    reports,
    circularDependencies,
    outdatedPackages,
    duplicatePackages,
    deprecatedImports,
    findings,
  };
}

const FINDING_TITLES: Readonly<Record<DependencyFindingCode, string>> = {
  DEPENDENCY_CIRCULAR: "Circular dependency",
  DEPENDENCY_DEPRECATED_API: "Deprecated API usage",
  DEPENDENCY_DUPLICATE_PACKAGE: "Duplicate package versions",
};

const FINDING_RECOMMENDATIONS: Readonly<Record<DependencyFindingCode, string>> = {
  DEPENDENCY_CIRCULAR: "Extract the shared code into a separate module to break the import cycle",
  DEPENDENCY_DEPRECATED_API: "Replace the deprecated API with the suggested modern alternative",
  DEPENDENCY_DUPLICATE_PACKAGE: "Dedupe the lock file (for example `npm dedupe`) or align version ranges",
};

/**
 * Analyses dependencies for circular imports, duplicate and outdated packages, and deprecated APIs.
 * Severity levels used: warning, error.
 */
export class DependencyGuard extends BaseGuard {
  private options: DependencyAuditOptions;

  constructor(options: DependencyAuditOptions, context?: AuditContext) {
    super("dependency-guard", context);
    this.options = options;
  }

  /**
   * Run the dependency audit and map each structured finding to an issue with a stable code.
   *
   * @returns Audit result
   */
  async execute(): Promise<AuditResult> {
    const result = performDependencyAuditInternal(this.options.targetPath);

    const issues: AuditIssue[] = result.findings.map((finding) =>
      this.createIssue(
        finding.code,
        finding.severity,
        FINDING_TITLES[finding.code],
        finding.message,
        finding.file === undefined ? undefined : { file: finding.file },
        FINDING_RECOMMENDATIONS[finding.code]
      )
    );

    if (issues.length === 0) {
      return this.ok("No dependency issues detected");
    }

    return this.issues(issues, `Found ${issues.length} dependency issue(s)`);
  }
}

/**
 * Run the dependency audit on a project directory.
 *
 * @param targetPath - Project root
 * @returns Audit result
 * @deprecated Use DependencyGuard class instead
 */
export function performDependencyAudit(targetPath: string): DependencyAuditResult {
  return performDependencyAuditInternal(targetPath);
}
