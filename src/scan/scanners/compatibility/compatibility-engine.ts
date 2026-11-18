import * as fs from "node:fs";
import * as path from "node:path";
import semver, { type SemVer } from "semver";
import type { ScannerEngine, ScanContext, ScanResult } from "../../core/contracts/scanner-engine.js";
import { createScanIssue, type ScanIssueInput } from "../../core/findings/finding.js";

interface KnownRule {
  packageA: string;
  packageB: string;
  check: (verA: SemVer, verB: SemVer) => string | null;
}

const KNOWN_COMPATIBILITY_RULES: KnownRule[] = [
  {
    packageA: "react",
    packageB: "next",
    check: (reactVer, nextVer) => {
      const oldNext = nextVer.major === 13 || (nextVer.major === 14 && nextVer.minor <= 1);
      if (reactVer.major === 19 && oldNext) {
        return `Next.js ${nextVer.version} has known stability issues with React 19. Upgrade Next.js to 15+ or use React 18.`;
      }
      return null;
    },
  },
  {
    packageA: "typescript",
    packageB: "eslint",
    check: (tsVer, eslintVer) => {
      if (tsVer.major >= 5 && eslintVer.major === 7) {
        return `TypeScript 5+ is incompatible with legacy ESLint 7. Upgrade ESLint to 8 or 9.`;
      }
      return null;
    },
  },
];

/**
 * Compatibility engine class.
 */
export class CompatibilityEngine implements ScannerEngine {
  readonly name = "compatibility";

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
      return { scanner: this.name, status: "success", findings: [] };
    }

    const findings: ScanIssueInput[] = [];
    let packageJson: {
      engines?: Record<string, string>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };

    try {
      packageJson = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    } catch {
      return {
        scanner: this.name,
        status: "failed",
        findings: [],
        error: "Failed to parse package.json for compatibility scanning.",
      };
    }

    // 1. Node runtime engine check
    const requiredNode = packageJson.engines?.node;
    if (requiredNode && semver.validRange(requiredNode) && !semver.satisfies(process.version, requiredNode)) {
      findings.push({
        id: "compat-node-engine-mismatch",
        title: "Node.js Engine Mismatch",
        message: `Current Node.js runtime (${process.version}) does not satisfy project requirement: ${requiredNode}`,
        severity: "high",
        category: "compatibility",
        source: this.name,
        confidence: "confirmed",
        file: "package.json",
        remediation: `Switch Node.js version to satisfy ${requiredNode}.`,
      });
    }

    // 2. Known ecosystem pairings check
    const allDeps = {
      ...(packageJson.dependencies ?? {}),
      ...(packageJson.devDependencies ?? {}),
      ...(context.dependencies ?? {}),
      ...(context.devDependencies ?? {}),
    };

    for (const rule of KNOWN_COMPATIBILITY_RULES) {
      const verA = allDeps[rule.packageA];
      const verB = allDeps[rule.packageB];
      if (verA && verB) {
        const parsedA = semver.coerce(verA);
        const parsedB = semver.coerce(verB);
        if (!parsedA || !parsedB) continue;
        const issue = rule.check(parsedA, parsedB);
        if (issue) {
          findings.push({
            id: `compat-${rule.packageA}-${rule.packageB}`,
            title: `Ecosystem Mismatch: ${rule.packageA} & ${rule.packageB}`,
            message: issue,
            severity: "medium",
            category: "compatibility",
            source: this.name,
            confidence: "inferred",
            file: "package.json",
            remediation: `Adjust versions for ${rule.packageA} and ${rule.packageB} to ensure verified interoperability.`,
          });
        }
      }
    }

    return {
      scanner: this.name,
      status: "success",
      findings: findings.map(createScanIssue),
    };
  }
}
