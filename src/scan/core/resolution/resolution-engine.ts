import type { Finding } from "../findings/finding.js";
import type {
  ResolutionPlan,
  PackageChange,
  CompatibilityStatus,
  RiskLevel,
  ResolutionDirection,
} from "./resolution-plan.js";
import { DependencyGraph } from "./dependency-graph.js";

export class ResolutionEngine {
  private graph: DependencyGraph;

  constructor(graph: DependencyGraph) {
    this.graph = graph;
  }

  /**
   * Generates deterministically ranked resolution plans for detected dependency findings.
   */
  public generatePlans(findings: Finding[]): ResolutionPlan[] {
    const plans: ResolutionPlan[] = [];
    const dependencyFindings = findings.filter(
      (f) => f.dependencyProblem !== undefined
    );

    for (const finding of dependencyFindings) {
      const problem = finding.dependencyProblem!;
      const fixedVersions = problem.fixedVersions || [];
      if (fixedVersions.length === 0) {
        continue;
      }

      // 1. Identify OSV fixed-version candidates. These are candidates, not proof of safety.
      // Sort fixed versions in ascending semver
      const sortedCandidates = [...fixedVersions].sort((a, b) => this.compareSemver(a, b));
      // Select the highest fixed boundary reported across applicable advisories.
      // A post-change OSV query is still required before the resolution is accepted.
      const selectedCandidate = sortedCandidates[sortedCandidates.length - 1];
      if (!selectedCandidate) continue;

      const currentVer = problem.installedVersion;
      const isUp = this.compareSemver(selectedCandidate, currentVer) > 0;
      const direction: ResolutionDirection = isUp ? "upgrade" : "downgrade";

      // Compatibility check
      const compat = this.graph.checkCompatibility(problem.package, selectedCandidate);

      // Assess Risk
      const currentMajor = parseInt(currentVer.split(".")[0] || "0", 10);
      const targetMajor = parseInt(selectedCandidate.split(".")[0] || "0", 10);
      const isMajorJump = targetMajor !== currentMajor;
      const risk: RiskLevel = isMajorJump ? "Medium" : "Low";

      const baseChange: PackageChange = {
        packageName: problem.package,
        currentVersion: currentVer,
        targetVersion: selectedCandidate,
        direction,
        reason: `Resolves ${problem.advisoryCount} applicable OSV security advisories.`,
      };

      // Plan A: OSV-derived candidate
      const planA: ResolutionPlan = {
        id: `plan-${problem.package}-candidate`,
        title: `Candidate ${direction === "upgrade" ? "Upgrade" : "Downgrade"}`,
        planName: `Plan A — Candidate ${direction === "upgrade" ? "Upgrade" : "Downgrade"}`,
        reason: `Uses an OSV fixed-version boundary reported for ${problem.advisoryCount} applicable advisories.`,
        changes: [baseChange],
        findingsResolved: [finding],
        securityImpact: "Expected to address applicable OSV advisories; requires a successful post-change scan.",
        compatibility: compat.status,
        risk,
        affectedPackages: [problem.package],
        explanation: `Proposes ${problem.package} ${currentVer} → ${selectedCandidate}. This is a candidate until native resolution and verification complete.`,
        baseFingerprint: this.graph.createFingerprint(),
        limitations: [
          "Target runtime compatibility is not proven by OSV fixed-version data.",
          "A native package-manager resolution and post-change verification are required.",
        ],
      };
      plans.push(planA);

      // Check for Coordinated Changes (e.g. Prisma + @prisma/client, or peer dependencies)
      const relatedPackages = this.graph.getRelatedPackages(problem.package);
      if (relatedPackages.length > 0) {
        const coordinatedChanges: PackageChange[] = [baseChange];
        for (const relName of relatedPackages) {
          const relPkg = this.graph.getPackage(relName);
          if (relPkg) {
            const relCurrent = relPkg.installedVersion || relPkg.declaredVersion;
            // Coordinated target: matching target major or compatible version
            const relTarget = selectedCandidate;
            coordinatedChanges.push({
              packageName: relName,
              currentVersion: relCurrent,
              targetVersion: relTarget,
              direction: "coordinated-upgrade",
              reason: `Known exact-version family pairing with ${problem.package}@${selectedCandidate}.`,
            });
          }
        }

        const planB: ResolutionPlan = {
          id: `plan-${problem.package}-coordinated`,
          title: "Coordinated Upgrade",
          planName: "Plan B — Coordinated Upgrade",
          reason: `Coordinates upgrade of ${problem.package} with related ecosystem packages (${relatedPackages.join(", ")}).`,
          changes: coordinatedChanges,
          findingsResolved: [finding],
          securityImpact: "Expected to address applicable OSV advisories; requires a successful post-change scan.",
          compatibility: "Unknown",
          risk: isMajorJump ? "Medium" : "Low",
          affectedPackages: coordinatedChanges.map((c) => c.packageName),
          explanation: `Proposes an exact-version family update for ${coordinatedChanges.map((c) => c.packageName).join(" and ")}; native resolution is still required.`,
          baseFingerprint: this.graph.createFingerprint(),
          limitations: ["The coordinated candidate has not yet been resolved by the native package manager."],
        };
        plans.push(planB);
      }

      // Automatic downgrade plans are intentionally deferred. Older fixed boundaries
      // do not prove that a downgrade is secure or compatible with the application.
    }

    return this.rankPlans(plans);
  }

  /**
   * Deterministically rank plans based on security, compatibility, package count, and risk.
   */
  private rankPlans(plans: ResolutionPlan[]): ResolutionPlan[] {
    const riskScore = (r: RiskLevel): number => {
      switch (r) {
        case "Low":
          return 1;
        case "Medium":
          return 2;
        case "High":
          return 3;
      }
    };

    const compatScore = (c: CompatibilityStatus): number => {
      switch (c) {
        case "Compatible":
          return 1;
        case "Unknown":
          return 2;
        case "Incompatible":
          return 3;
      }
    };

    return [...plans].sort((a, b) => {
      // 1. Compatibility
      const compDiff = compatScore(a.compatibility) - compatScore(b.compatibility);
      if (compDiff !== 0) return compDiff;

      // 2. Risk level
      const riskDiff = riskScore(a.risk) - riskScore(b.risk);
      if (riskDiff !== 0) return riskDiff;

      // 3. Number of affected packages (fewer is safer)
      const countDiff = a.changes.length - b.changes.length;
      if (countDiff !== 0) return countDiff;

      // 4. Stable alphabetical ID
      return a.id.localeCompare(b.id);
    });
  }

  private compareSemver(v1: string, v2: string): number {
    const p1 = v1.split(".").map((n) => parseInt(n.replace(/\D/g, ""), 10) || 0);
    const p2 = v2.split(".").map((n) => parseInt(n.replace(/\D/g, ""), 10) || 0);
    for (let i = 0; i < 3; i++) {
      const a = p1[i] ?? 0;
      const b = p2[i] ?? 0;
      if (a !== b) return a - b;
    }
    return 0;
  }
}
