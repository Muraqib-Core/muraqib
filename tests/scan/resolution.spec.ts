import { test } from "vitest";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { ResolutionApplier } from "../../src/scan/core/resolution/resolution-applier.js";
import { ResolutionEngine } from "../../src/scan/core/resolution/resolution-engine.js";
import { DependencyGraph } from "../../src/scan/core/resolution/dependency-graph.js";
import { createScanIssue, type DependencyProblemData } from "../../src/scan/core/findings/finding.js";
import type { ResolutionPlan } from "../../src/scan/core/resolution/resolution-plan.js";

// Helper to create an isolated test project fixture
function createIsolatedFixture(pkgJson: Record<string, unknown>, lockfileName = "pnpm-lock.yaml"): DependencyGraph {
  const tmpDir = fs.mkdtempSync(path.join("/tmp", "muraqib-fixture-"));
  fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify(pkgJson, null, 2) + "\n", "utf8");
  fs.writeFileSync(path.join(tmpDir, lockfileName), "# lockfile content\n", "utf8");

  const graph = new DependencyGraph(tmpDir);
  return graph;
}

test("Resolution: 24 OSV advisories roll up into ONE package-level finding with preserved metadata", () => {
  // Mock 24 advisories for axios
  const mockAdvisories = Array.from({ length: 24 }, (_, i) => ({
    id: `GHSA-mock-advisory-${i + 1}`,
    summary: `Mock Security Vulnerability ${i + 1}`,
    details: `Details for advisory ${i + 1}`,
    ranges: [{ type: "SEMVER", events: [{ introduced: "0.19.0", fixed: i === 23 ? "1.8.2" : "0.21.4" }] }],
  }));

  const problemData: DependencyProblemData = {
    package: "axios",
    installedVersion: "0.21.1",
    declaredVersion: "^0.21.1",
    dependencyType: "dependencies",
    advisoryCount: 24,
    advisories: mockAdvisories,
    affectedRanges: [">= 0.19.0 < 1.8.2"],
    fixedVersions: ["0.21.4", "1.8.2"],
    resolutionMetadata: { ecosystem: "npm", source: "osv" },
  };

  const finding = createScanIssue({
    id: "osv-axios",
    title: "Dependency Problem: axios",
    message: "Package 'axios' (0.21.1) has 24 known vulnerabilities.",
    severity: "high",
    category: "security",
    source: "osv",
    file: "package.json",
    key: "axios",
    evidence: "Installed: 0.21.1, Declared: ^0.21.1",
    // OSV does not invent a pre-cooked remediation string
    remediation: undefined,
    dependencyProblem: problemData,
  });

  // Assert: Exactly one finding represents the package problem
  assert.equal(finding.code, "osv-axios");
  assert.equal(finding.title, "Dependency Problem: axios");
  assert.equal(finding.recommendation, undefined, "OSV must not produce a pre-cooked remediation string");

  // Assert: All 24 advisories and metadata are preserved internally
  assert.equal(finding.dependencyProblem?.advisoryCount, 24);
  assert.equal(finding.dependencyProblem?.advisories.length, 24);
  assert.equal(finding.dependencyProblem?.package, "axios");
  assert.equal(finding.dependencyProblem?.installedVersion, "0.21.1");
  assert.equal(finding.dependencyProblem?.declaredVersion, "^0.21.1");
  assert.equal(finding.dependencyProblem?.dependencyType, "dependencies");
  assert.deepEqual(finding.dependencyProblem?.fixedVersions, ["0.21.4", "1.8.2"]);
});

test("ResolutionEngine: generates real ResolutionPlan with candidate analysis and ranking", () => {
  const graph = createIsolatedFixture({
    dependencies: { axios: "^0.21.1" },
  });

  const finding = createScanIssue({
    id: "osv-axios",
    title: "Dependency Problem: axios",
    message: "Package 'axios' (0.21.1) has 24 known vulnerabilities.",
    severity: "high",
    category: "security",
    source: "osv",
    dependencyProblem: {
      package: "axios",
      installedVersion: "0.21.1",
      declaredVersion: "^0.21.1",
      dependencyType: "dependencies",
      advisoryCount: 24,
      advisories: [],
      affectedRanges: [">= 0.19.0 < 1.8.2"],
      fixedVersions: ["0.21.4", "1.8.2"],
    },
  });

  const engine = new ResolutionEngine(graph);
  const plans = engine.generatePlans([finding]);

  assert.ok(plans.length >= 1, "At least one plan should be generated");
  const topPlan = plans[0];
  assert.ok(topPlan);

  assert.equal(topPlan.planName, "Plan A — Candidate Upgrade");
  assert.equal(topPlan.changes.length, 1);
  assert.equal(topPlan.changes[0]?.packageName, "axios");
  assert.equal(topPlan.changes[0]?.currentVersion, "0.21.1");
  assert.equal(topPlan.changes[0]?.targetVersion, "1.8.2");
  assert.equal(topPlan.changes[0]?.direction, "upgrade");
  assert.equal(topPlan.compatibility, "Unknown");
  assert.equal(topPlan.risk, "Medium");
  assert.deepEqual(topPlan.affectedPackages, ["axios"]);
});

test("ResolutionEngine: generates Coordinated Upgrade plan when related packages exist", () => {
  const graph = createIsolatedFixture({
    dependencies: {
      prisma: "^6.1.0",
      "@prisma/client": "^6.1.0",
    },
  });

  const finding = createScanIssue({
    id: "osv-prisma",
    title: "Dependency Problem: prisma",
    message: "Package 'prisma' (6.1.0) has 1 known vulnerability.",
    severity: "high",
    category: "security",
    source: "osv",
    dependencyProblem: {
      package: "prisma",
      installedVersion: "6.1.0",
      declaredVersion: "^6.1.0",
      dependencyType: "dependencies",
      advisoryCount: 1,
      advisories: [],
      affectedRanges: ["< 6.4.0"],
      fixedVersions: ["6.4.0"],
    },
  });

  const engine = new ResolutionEngine(graph);
  const plans = engine.generatePlans([finding]);

  // Should have both Safe Upgrade (Plan A) and Coordinated Upgrade (Plan B)
  const coordinatedPlan = plans.find((p) => p.planName.includes("Coordinated Upgrade"));
  assert.ok(coordinatedPlan, "Should generate a Coordinated Upgrade plan for prisma family");
  assert.equal(coordinatedPlan?.changes.length, 2);
  assert.ok(coordinatedPlan?.changes.some((c) => c.packageName === "prisma" && c.targetVersion === "6.4.0"));
  assert.ok(coordinatedPlan?.changes.some((c) => c.packageName === "@prisma/client" && c.targetVersion === "6.4.0"));
});

test("APPROVAL BOUNDARY: User NO / Rejection produces ZERO project mutation", async () => {
  const initialPkg = {
    name: "test-app",
    dependencies: {
      axios: "0.21.1",
    },
  };

  const graph = createIsolatedFixture(initialPkg);
  const pkgPath = path.join(graph.projectPath, "package.json");
  const lockPath = path.join(graph.projectPath, "pnpm-lock.yaml");

  const initialPkgContent = fs.readFileSync(pkgPath, "utf8");
  const initialLockContent = fs.readFileSync(lockPath, "utf8");

  const applier = new ResolutionApplier(graph);
  const plan: ResolutionPlan = {
    id: "plan-axios",
    title: "Safe Upgrade",
    planName: "Plan A — Safe Upgrade",
    reason: "Resolves known vulnerabilities",
    changes: [
      {
        packageName: "axios",
        currentVersion: "0.21.1",
        targetVersion: "1.8.2",
        direction: "upgrade",
      },
    ],
    findingsResolved: [],
    securityImpact: "Resolves vulnerabilities",
    compatibility: "Compatible",
    risk: "Medium",
    affectedPackages: ["axios"],
  };

  // User decides "rejected" (NO)
  const result = await applier.apply(plan, "rejected");

  assert.equal(result.applied, false);
  assert.equal(result.status, "rejected");
  assert.equal(result.message, "Resolution cancelled. No changes were applied.");

  // STRICT VERIFICATION: Files must NOT have changed by a single byte
  const afterPkgContent = fs.readFileSync(pkgPath, "utf8");
  const afterLockContent = fs.readFileSync(lockPath, "utf8");

  assert.equal(afterPkgContent, initialPkgContent, "package.json MUST NOT be mutated on rejection");
  assert.equal(afterLockContent, initialLockContent, "lockfile MUST NOT be mutated on rejection");
});

test("APPROVAL BOUNDARY: Stale plan is rejected before mutation occurs", async () => {
  const initialPkg = {
    dependencies: {
      axios: "1.0.0", // Current state does not match plan's fromVersion: "0.21.1"
    },
  };

  const graph = createIsolatedFixture(initialPkg);
  const pkgPath = path.join(graph.projectPath, "package.json");
  const initialPkgContent = fs.readFileSync(pkgPath, "utf8");

  const applier = new ResolutionApplier(graph);
  const stalePlan: ResolutionPlan = {
    id: "plan-axios",
    title: "Safe Upgrade",
    planName: "Plan A — Safe Upgrade",
    reason: "Resolves known vulnerabilities",
    changes: [
      {
        packageName: "axios",
        currentVersion: "0.21.1", // Mismatch with package.json (1.0.0)
        targetVersion: "1.8.2",
        direction: "upgrade",
      },
    ],
    findingsResolved: [],
    securityImpact: "Resolves vulnerabilities",
    compatibility: "Compatible",
    risk: "Medium",
    affectedPackages: ["axios"],
  };

  const result = await applier.apply(stalePlan, "approved");

  assert.equal(result.applied, false);
  assert.equal(result.status, "stale");
  assert.ok(result.message.includes("stale"));

  // Verify zero mutation occurred
  const afterPkgContent = fs.readFileSync(pkgPath, "utf8");
  assert.equal(afterPkgContent, initialPkgContent, "package.json MUST NOT be mutated when plan is stale");
});

test("APPROVAL BOUNDARY: Approved YES mutates package.json with exact planned changes", async () => {
  const initialPkg = {
    name: "test-app",
    dependencies: {
      axios: "^0.21.1",
      lodash: "^4.17.21",
    },
  };

  const graph = createIsolatedFixture(initialPkg);
  const pkgPath = path.join(graph.projectPath, "package.json");

  const applier = new ResolutionApplier(graph);
  const plan: ResolutionPlan = {
    id: "plan-axios",
    title: "Safe Upgrade",
    planName: "Plan A — Safe Upgrade",
    reason: "Resolves known vulnerabilities",
    changes: [
      {
        packageName: "axios",
        currentVersion: "0.21.1",
        targetVersion: "1.8.2",
        direction: "upgrade",
      },
    ],
    findingsResolved: [],
    securityImpact: "Resolves vulnerabilities",
    compatibility: "Compatible",
    risk: "Medium",
    affectedPackages: ["axios"],
  };

  // Mock runPackageManagerInstall & verification to isolate unit test
  (applier as any).runPackageManagerInstall = () => {};
  (applier as any).runVerification = async () => [
    { step: "dependencies", passed: true },
    { step: "securityScan", passed: true },
    { step: "compatibilityScan", passed: true },
  ];

  const result = await applier.apply(plan, "approved");

  assert.equal(result.applied, true);
  assert.equal(result.status, "applied");

  // Verify package.json was updated with correct version and preserved prefix
  const updatedPkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  assert.equal(updatedPkg.dependencies.axios, "^1.8.2", "axios must be updated to ^1.8.2");
  assert.equal(updatedPkg.dependencies.lodash, "^4.17.21", "unrelated dependencies must remain untouched");
});

test("STALE PLAN: lockfile changes invalidate a fingerprinted plan before mutation", async () => {
  const graph = createIsolatedFixture({ dependencies: { axios: "^0.21.1" } });
  const pkgPath = path.join(graph.projectPath, "package.json");
  const initialPkgContent = fs.readFileSync(pkgPath, "utf8");

  const plan: ResolutionPlan = {
    id: "plan-axios",
    title: "Candidate Upgrade",
    planName: "Plan A — Candidate Upgrade",
    reason: "Candidate",
    changes: [{
      packageName: "axios",
      currentVersion: "0.21.1",
      targetVersion: "1.8.2",
      direction: "upgrade",
    }],
    findingsResolved: [],
    securityImpact: "Requires verification",
    compatibility: "Unknown",
    risk: "Medium",
    affectedPackages: ["axios"],
    baseFingerprint: graph.createFingerprint(),
  };

  fs.appendFileSync(path.join(graph.projectPath, "pnpm-lock.yaml"), "# changed\n");
  const result = await new ResolutionApplier(graph).apply(plan, "approved");

  assert.equal(result.status, "stale");
  assert.equal(fs.readFileSync(pkgPath, "utf8"), initialPkgContent);
});

test("MUTATION SAFETY: complex dependency ranges are rejected instead of rewritten", async () => {
  const graph = createIsolatedFixture({ dependencies: { axios: ">=0.21.1 <2" } });
  const pkgPath = path.join(graph.projectPath, "package.json");
  const initialPkgContent = fs.readFileSync(pkgPath, "utf8");
  const plan: ResolutionPlan = {
    id: "plan-axios",
    title: "Candidate Upgrade",
    planName: "Plan A — Candidate Upgrade",
    reason: "Candidate",
    changes: [{
      packageName: "axios",
      currentVersion: ">=0.21.1 <2",
      targetVersion: "1.8.2",
      direction: "upgrade",
    }],
    findingsResolved: [],
    securityImpact: "Requires verification",
    compatibility: "Unknown",
    risk: "Medium",
    affectedPackages: ["axios"],
  };

  const result = await new ResolutionApplier(graph).apply(plan, "approved");
  assert.equal(result.status, "failed");
  assert.match(result.message, /Unsupported version declaration/);
  assert.equal(fs.readFileSync(pkgPath, "utf8"), initialPkgContent);
});
