/*
### 🔍 Dependency & Architecture Auditor (`dependency-audit.ts`)

An advanced auditing utility designed to analyze project source code dependencies, detect structural issues, and ensure code health by scanning TypeScript/JavaScript files.

#### Key Features:
* **Deprecated API Detection:** Scans codebase for obsolete or deprecated APIs (e.g., `url.parse`, `fs.exists`, `__dirname` in ESM) and suggests modern alternatives.
* **Circular Dependency Detection:** Builds a file relationship graph and runs a Depth-First Search (DFS) algorithm to locate cyclic module imports.
* **Version & Lockfile Inspection:** Analyzes `package.json` for potentially unstable `v0.x` packages and scans lock files (`package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`) for duplicate package versions.
*/
import fs from "fs";
import path from "path";
import { scanProjectFiles } from "../utils/file-scanner.js";

export interface DependencyAuditResult { // muraqib-ignore-dead: auto-suppressed by script for DependencyAuditResult
  isClean: boolean;
  reports: string[];
  circularDependencies: string[][];
  outdatedPackages: string[];
  duplicatePackages: string[];
  deprecatedImports: string[];
}

const DEPRECATED_PATTERNS: Array<{ pattern: RegExp; suggestion: string }> = [
  { pattern: /\burl\.parse\b/, suggestion: "Use new URL() constructor instead" },
  { pattern: /\bquerystring\b/, suggestion: "Use URLSearchParams instead" },
  { pattern: /\bcrypto\.createDecipher\b/, suggestion: "Use crypto.createDecipheriv instead" },
  { pattern: /\bnew\s+Buffer\s*\(/, suggestion: "Use Buffer.from() or Buffer.alloc() explicitly" },
  { pattern: /\bBuffer\s*\(/, suggestion: "Avoid calling Buffer() as a function; use Buffer.from/alloc" },
  { pattern: /\bfs\.exists\s*\(/, suggestion: "Use fs.existsSync or fs.promises.access instead" },
  { pattern: /\bprocess\.binding\b/, suggestion: "Deprecated internal API" },
  { pattern: /__dirname\b/, suggestion: "Use import.meta.url with fileURLToPath instead (ESM)" },
  { pattern: /\brequire\s*\(/, suggestion: "Use dynamic import() instead (ESM)" },
];

export function performDependencyAudit(targetPath: string): DependencyAuditResult {
  const reports: string[] = [];
  const circularDependencies: string[][] = [];
  const outdatedPackages: string[] = [];
  const duplicatePackages: string[] = [];
  const deprecatedImports: string[] = [];

  const scannedFiles = scanProjectFiles(targetPath, ["ts", "js"]);

  const graph: Map<string, Set<string>> = new Map();

  for (const scannedFile of scannedFiles) {
    const { relativePath, content, path: fullPath } = scannedFile as { relativePath: string; content: string; path: string };
    const isGenerated = /(?:\.d\.ts|generated|dist|build|coverage|node_modules)/i.test(relativePath);
    if (isGenerated) {
      continue;
    }

    // Avoid scanning this file (auditor) to prevent self-matching deprecated patterns
    if (/dependency-guard\.ts$/.test(relativePath) || relativePath.includes("core\\dependency-guard")) {
      continue;
    }

    graph.set(relativePath, new Set());

    const importRegex = /import\s+.*?\s+from\s+['"]([^'"]+)['"]/g;
    let match;
    while ((match = importRegex.exec(content)) !== null) {
      const importPath = match[1];
      if (!importPath) continue;

      if (importPath.startsWith(".") || importPath.startsWith("/")) {
        const resolved = path.resolve(path.dirname(fullPath), importPath);
        const possiblePaths = [
          resolved,
          resolved + ".ts",
          resolved + ".js",
          path.join(resolved, "index.ts"),
          path.join(resolved, "index.js"),
        ];

        for (const p of possiblePaths) {
          if (fs.existsSync(p)) {
            const targetRelative = path.relative(targetPath, p);
            graph.get(relativePath)!.add(targetRelative);
            break;
          }
        }
      }
    }

    for (const dp of DEPRECATED_PATTERNS) {
      if (dp.pattern.test(content)) {
        const isAllowedPattern = /require\s*\(/.test(dp.pattern.source) && /(?:src\/index|scripts|config|tests)/i.test(relativePath);
// muraqib-unreachable: flagged by automated triage. Review before removal.
        if (isAllowedPattern) {
          continue;
        }
        const suggestion = dp.suggestion;
        const message = `Deprecated API usage in ${relativePath}: ${dp.pattern} -> ${suggestion}`;
        deprecatedImports.push(message);
        reports.push(message);
      }
    }
  }

  // Detect circular dependencies using DFS
  const visited = new Set<string>();
  const recursionStack = new Set<string>();
  const pathStack: string[] = [];

  function dfs(node: string): void {
    visited.add(node);
    recursionStack.add(node);
    pathStack.push(node);

    const neighbors = graph.get(node) || new Set();
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        dfs(neighbor);
      } else if (recursionStack.has(neighbor)) {
        const cycleStart = pathStack.indexOf(neighbor);
        const cycle = pathStack.slice(cycleStart).concat([neighbor]);
        circularDependencies.push(cycle);
        reports.push(`Circular dependency detected: ${cycle.join(" → ")}`);
      }
    }

    pathStack.pop();
    recursionStack.delete(node);
  }

  for (const node of graph.keys()) {
    if (!visited.has(node)) {
      dfs(node);
    }
  }

  // Check package.json for duplicates and outdated
  const packageJsonPath = path.join(targetPath, "package.json");
  if (fs.existsSync(packageJsonPath)) {
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
    const allDeps: Record<string, string> = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
    };

    const depNames = Object.keys(allDeps);
    for (const dep of depNames) {
      const version = allDeps[dep];
      if (version && version.startsWith("^0.")) {
        outdatedPackages.push(`${dep}@${version} — v0.x may have breaking changes`);
        reports.push(`Potentially outdated: ${dep}@${version} (v0.x detected)`);
      }
    }

    const lockPaths = [
      path.join(targetPath, "package-lock.json"),
      path.join(targetPath, "yarn.lock"),
      path.join(targetPath, "pnpm-lock.yaml"),
    ];

    for (const lockPath of lockPaths) {
      if (fs.existsSync(lockPath)) {
        const lockContent = fs.readFileSync(lockPath, "utf-8");
        const packageCounts: Map<string, number> = new Map();

        const nameRegex = /"([^"]+@\d+\.\d+\.\d+)"/g;
        let lockMatch;
        while ((lockMatch = nameRegex.exec(lockContent)) !== null) {
          const fullName = lockMatch[1];
          if (!fullName) continue;
          const pkgName = fullName.split("@")[0];
          if (!pkgName) continue;
          packageCounts.set(pkgName, (packageCounts.get(pkgName) || 0) + 1);
        }

        for (const [pkgName, count] of packageCounts) {
          if (count > 1) {
            duplicatePackages.push(`${pkgName} (${count} versions in lock file)`);
            reports.push(`Duplicate package versions: ${pkgName} appears ${count} times`);
          }
        }
      }
    }
  }

  return {
    isClean: reports.length === 0,
    reports,
    circularDependencies,
    outdatedPackages,
    duplicatePackages,
    deprecatedImports,
  };
}