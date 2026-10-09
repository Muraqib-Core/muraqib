import * as fs from "node:fs";
import * as path from "node:path";
import type { ScannerEngine, ScanContext, ScanResult } from "../../core/contracts/scanner-engine.js";
import type { Finding } from "../../core/findings/finding.js";

interface KnownRule {
  packageA: string;
  packageB: string;
  check: (verA: string, verB: string) => string | null;
}

const KNOWN_COMPATIBILITY_RULES: KnownRule[] = [
  {
    packageA: "react",
    packageB: "next",
    check: (reactVer, nextVer) => {
      if (
        reactVer.startsWith("19") &&
        (nextVer.startsWith("13") || nextVer.startsWith("14.0") || nextVer.startsWith("14.1"))
      ) {
        return `Next.js ${nextVer} has known stability issues with React 19. Upgrade Next.js to 15+ or use React 18.`;
      }
      return null;
    },
  },
  {
    packageA: "typescript",
    packageB: "eslint",
    check: (tsVer, eslintVer) => {
      if (tsVer.startsWith("5") && eslintVer.startsWith("7")) {
        return `TypeScript 5+ is incompatible with legacy ESLint 7. Upgrade ESLint to 8 or 9.`;
      }
      return null;
    },
  },
];

export class CompatibilityEngine implements ScannerEngine {
  readonly name = "compatibility";

  supports(context: ScanContext): boolean {
    const pkgPath = path.join(context.projectPath, "package.json");
    return fs.existsSync(pkgPath);
  }

  async scan(context: ScanContext): Promise<ScanResult> {
    const pkgPath = path.join(context.projectPath, "package.json");
    if (!fs.existsSync(pkgPath)) {
      return { scanner: this.name, status: "success", findings: [] };
    }

    const findings: Finding[] = [];
    let packageJson: {
      engines?: Record<string, string>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    } = {};

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
    if (packageJson.engines?.node) {
      const requiredNode = packageJson.engines.node;
      const currentNode = process.version;
      const majorMatch = requiredNode.match(/\d+/);
      const currentMajorMatch = currentNode.match(/\d+/);

      if (majorMatch?.[0] && currentMajorMatch?.[0]) {
        const requiredMajor = parseInt(majorMatch[0], 10);
        const currentMajor = parseInt(currentMajorMatch[0], 10);
        if (requiredNode.includes(">=") && currentMajor < requiredMajor) {
          findings.push({
            id: "compat-node-engine-mismatch",
            title: "Node.js Engine Mismatch",
            message: `Current Node.js runtime (${currentNode}) does not satisfy project requirement: ${requiredNode}`,
            severity: "high",
            category: "compatibility",
            source: this.name,
            confidence: "confirmed",
            file: "package.json",
            remediation: `Switch Node.js version to satisfy ${requiredNode}.`,
          });
        }
      }
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
        const cleanA = verA.replace(/[\^~]/g, "");
        const cleanB = verB.replace(/[\^~]/g, "");
        const issue = rule.check(cleanA, cleanB);
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
      findings,
    };
  }
}
