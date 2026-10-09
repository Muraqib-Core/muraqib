import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import type { DependencyType } from "../findings/finding.js";

export interface PackageMetadata {
  name: string;
  declaredVersion: string;
  installedVersion?: string | undefined;
  dependencyType: DependencyType;
  dependencies?: Record<string, string> | undefined;
  devDependencies?: Record<string, string> | undefined;
  peerDependencies?: Record<string, string> | undefined;
  optionalDependencies?: Record<string, string> | undefined;
  engines?: Record<string, string> | undefined;
}

export type PackageManagerName = "pnpm" | "npm" | "yarn" | "bun";

export class DependencyGraph {
  public readonly projectPath: string;
  public readonly packageManager: PackageManagerName;
  public readonly lockfilePath?: string | undefined;
  public readonly declaredPackages: Map<string, PackageMetadata> = new Map();
  public readonly projectEngines?: Record<string, string> | undefined;

  constructor(projectPath: string) {
    this.projectPath = projectPath;
    const pkgPath = path.join(projectPath, "package.json");
    if (!fs.existsSync(pkgPath)) {
      throw new Error(`No package.json found at ${projectPath}`);
    }

    let rootPkg: any = {};
    try {
      rootPkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    } catch {
      throw new Error(`Failed to parse package.json at ${pkgPath}`);
    }

    this.projectEngines = rootPkg.engines;

    const declaredManager = typeof rootPkg.packageManager === "string"
      ? rootPkg.packageManager.split("@")[0]
      : undefined;
    const supportedManagers = new Set<PackageManagerName>(["pnpm", "npm", "yarn", "bun"]);
    const lockfiles: Record<PackageManagerName, string> = {
      pnpm: "pnpm-lock.yaml",
      npm: "package-lock.json",
      yarn: "yarn.lock",
      bun: "bun.lockb",
    };

    if (declaredManager && supportedManagers.has(declaredManager as PackageManagerName)) {
      this.packageManager = declaredManager as PackageManagerName;
    } else if (fs.existsSync(path.join(projectPath, lockfiles.pnpm))) {
      this.packageManager = "pnpm";
    } else if (fs.existsSync(path.join(projectPath, lockfiles.yarn))) {
      this.packageManager = "yarn";
    } else if (fs.existsSync(path.join(projectPath, lockfiles.bun))) {
      this.packageManager = "bun";
    } else {
      this.packageManager = "npm";
    }

    const selectedLockfile = path.join(projectPath, lockfiles[this.packageManager]);
    if (fs.existsSync(selectedLockfile)) this.lockfilePath = selectedLockfile;

    // Populate declared packages
    const sections: Array<{ type: DependencyType; obj: Record<string, string> | undefined }> = [
      { type: "dependencies", obj: rootPkg.dependencies },
      { type: "devDependencies", obj: rootPkg.devDependencies },
      { type: "peerDependencies", obj: rootPkg.peerDependencies },
      { type: "optionalDependencies", obj: rootPkg.optionalDependencies },
    ];

    for (const section of sections) {
      if (!section.obj) continue;
      for (const [name, declaredVersion] of Object.entries(section.obj)) {
        if (!this.declaredPackages.has(name)) {
          const installed = this.getInstalledMeta(name);
          this.declaredPackages.set(name, {
            name,
            declaredVersion,
            installedVersion: installed?.version ?? declaredVersion.replace(/[\^~]/g, ""),
            dependencyType: section.type,
            dependencies: installed?.dependencies,
            devDependencies: installed?.devDependencies,
            peerDependencies: installed?.peerDependencies,
            optionalDependencies: installed?.optionalDependencies,
            engines: installed?.engines,
          });
        }
      }
    }
  }

  public getPackage(name: string): PackageMetadata | undefined {
    return this.declaredPackages.get(name);
  }

  public getInstalledMeta(packageName: string): any | null {
    const pkgPath = path.join(this.projectPath, "node_modules", packageName, "package.json");
    if (!fs.existsSync(pkgPath)) return null;
    try {
      return JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    } catch {
      return null;
    }
  }

  /**
   * Identifies related packages that might require coordinated changes
   * (e.g. prisma and @prisma/client, react and react-dom, peer dependencies)
   */
  public getRelatedPackages(packageName: string): string[] {
    const related = new Set<string>();

    // Family pairings
    if (packageName === "prisma" && this.declaredPackages.has("@prisma/client")) {
      related.add("@prisma/client");
    } else if (packageName === "@prisma/client" && this.declaredPackages.has("prisma")) {
      related.add("prisma");
    }

    if (packageName === "react" && this.declaredPackages.has("react-dom")) {
      related.add("react-dom");
    } else if (packageName === "react-dom" && this.declaredPackages.has("react")) {
      related.add("react");
    }

    return Array.from(related);
  }

  public createFingerprint(): string {
    const hash = createHash("sha256");
    const relevantFiles = [
      "package.json",
      "pnpm-lock.yaml",
      "package-lock.json",
      "yarn.lock",
      "bun.lockb",
      ".npmrc",
      ".yarnrc.yml",
      "pnpm-workspace.yaml",
    ];

    hash.update(`manager:${this.packageManager}\n`);
    for (const fileName of relevantFiles) {
      const filePath = path.join(this.projectPath, fileName);
      hash.update(`file:${fileName}\n`);
      if (fs.existsSync(filePath)) {
        hash.update(fs.readFileSync(filePath));
      } else {
        hash.update("<missing>");
      }
    }
    return hash.digest("hex");
  }

  /**
   * Deterministic compatibility check based on declared engines and peerDependencies
   */
  public checkCompatibility(
    packageName: string,
    targetVersion: string
  ): { status: "Compatible" | "Unknown" | "Incompatible"; reason?: string } {
    const meta = this.getPackage(packageName);
    if (!meta) {
      return { status: "Unknown", reason: "Package not declared in project" };
    }

    // Check Node engine if specified
    if (meta.engines?.node) {
      const nodeReq = meta.engines.node;
      // Basic check against current process.version
      const currentMajor = parseInt(process.version.replace(/^v/, "").split(".")[0] || "0", 10);
      const match = nodeReq.match(/>=\s*(\d+)/);
      if (match && match[1]) {
        const reqMajor = parseInt(match[1], 10);
        if (currentMajor < reqMajor) {
          return {
            status: "Incompatible",
            reason: `Requires Node ${nodeReq}, but current Node is ${process.version}`,
          };
        }
      }
    }

    // Check peer dependencies of packages that depend on this
    for (const [otherName, otherMeta] of this.declaredPackages.entries()) {
      if (otherName === packageName) continue;
      const peerReq = otherMeta.peerDependencies?.[packageName];
      if (peerReq) {
        // e.g. "^2.0.0" and target is "3.0.0"
        const targetMajor = parseInt(targetVersion.split(".")[0] || "0", 10);
        const reqMatch = peerReq.match(/[\^~]?(\d+)/);
        if (reqMatch && reqMatch[1]) {
          const reqMajor = parseInt(reqMatch[1], 10);
          if (peerReq.startsWith("^") && targetMajor !== reqMajor) {
            return {
              status: "Incompatible",
              reason: `${otherName} requires peer dependency ${packageName}@${peerReq}`,
            };
          }
        }
      }
    }

    return {
      status: "Unknown",
      reason: "No conflict was detected from current metadata; target package metadata and native resolution have not been verified.",
    };
  }
}
