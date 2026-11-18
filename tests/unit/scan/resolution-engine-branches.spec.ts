import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DependencyGraph } from "../../../src/scan/core/resolution/dependency-graph.js";
import { ResolutionEngine } from "../../../src/scan/core/resolution/resolution-engine.js";
import { createScanIssue } from "../../../src/scan/core/findings/finding.js";
import type { ScanIssue } from "../../../src/scan/core/findings/finding.js";

const tmpDirs: string[] = [];

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function graphFor(manifest: Record<string, unknown>): DependencyGraph {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "muraqib-resolution-"));
  tmpDirs.push(dir);
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify(manifest), "utf8");
  return new DependencyGraph(dir);
}

function dependencyFinding(pkg: string, installed: string, fixed: string[]): ScanIssue {
  return createScanIssue({
    id: `osv-${pkg}`,
    title: `Dependency Problem: ${pkg}`,
    message: `${pkg} is vulnerable`,
    severity: "high",
    category: "security",
    source: "osv",
    file: "package.json",
    key: pkg,
    dependencyProblem: {
      package: pkg,
      installedVersion: installed,
      declaredVersion: `^${installed}`,
      dependencyType: "dependencies",
      advisoryCount: 1,
      advisories: [],
      affectedRanges: [],
      fixedVersions: fixed,
    },
  });
}

describe("ResolutionEngine.generatePlans", () => {
  it("ignores findings without dependency data or without fixed versions", () => {
    const engine = new ResolutionEngine(graphFor({ dependencies: { axios: "^0.21.1" } }));
    const plain = createScanIssue({
      id: "plain",
      title: "Plain",
      message: "not a dependency problem",
      severity: "low",
      category: "security",
      source: "osv",
      file: "package.json",
    });
    expect(engine.generatePlans([plain, dependencyFinding("axios", "0.21.1", [])])).toEqual([]);
  });

  it("picks the highest fixed version and marks a minor bump as low-risk upgrade", () => {
    const engine = new ResolutionEngine(graphFor({ dependencies: { axios: "^0.21.1" } }));
    const [plan] = engine.generatePlans([dependencyFinding("axios", "0.21.1", ["0.21.4", "0.21.2"])]);
    expect(plan?.changes[0]).toMatchObject({ targetVersion: "0.21.4", direction: "upgrade" });
    expect(plan?.risk).toBe("Low");
    expect(plan?.title).toBe("Candidate Upgrade");
  });

  it("labels a lower fixed boundary as a downgrade", () => {
    const engine = new ResolutionEngine(graphFor({ dependencies: { axios: "^2.0.0" } }));
    const [plan] = engine.generatePlans([dependencyFinding("axios", "2.0.0", ["1.8.2"])]);
    expect(plan?.changes[0]?.direction).toBe("downgrade");
    expect(plan?.title).toBe("Candidate Downgrade");
    expect(plan?.risk).toBe("Medium");
  });

  it("treats a major jump as medium risk", () => {
    const engine = new ResolutionEngine(graphFor({ dependencies: { axios: "^0.21.1" } }));
    const [plan] = engine.generatePlans([dependencyFinding("axios", "0.21.1", ["1.8.2"])]);
    expect(plan?.risk).toBe("Medium");
  });

  it("adds a coordinated plan for related family packages", () => {
    const engine = new ResolutionEngine(
      graphFor({ dependencies: { prisma: "^5.0.0", "@prisma/client": "^5.0.0" } }),
    );
    const plans = engine.generatePlans([dependencyFinding("prisma", "5.0.0", ["5.1.0"])]);
    expect(plans.map((p) => p.id).sort()).toEqual(["plan-prisma-candidate", "plan-prisma-coordinated"]);
    const coordinated = plans.find((p) => p.id === "plan-prisma-coordinated");
    expect(coordinated?.affectedPackages).toEqual(["prisma", "@prisma/client"]);
    expect(coordinated?.changes[1]).toMatchObject({ direction: "coordinated-upgrade", targetVersion: "5.1.0" });
  });

  it("ranks equal plans by fewer changes, then by id", () => {
    const engine = new ResolutionEngine(
      graphFor({
        dependencies: {
          prisma: "^5.0.0",
          "@prisma/client": "^5.0.0",
          zeta: "^1.0.0",
          alpha: "^1.0.0",
        },
      }),
    );
    const ranked = engine.generatePlans([
      dependencyFinding("zeta", "1.0.0", ["1.0.1"]),
      dependencyFinding("alpha", "1.0.0", ["1.0.1"]),
      dependencyFinding("prisma", "5.0.0", ["5.1.0"]),
    ]);
    expect(ranked.map((p) => p.id)).toEqual([
      "plan-alpha-candidate",
      "plan-prisma-candidate",
      "plan-zeta-candidate",
      "plan-prisma-coordinated",
    ]);
  });

  it("puts incompatible plans after unknown ones and orders by risk", () => {
    const graph = graphFor({
      dependencies: { lib: "^1.0.0", other: "^1.0.0", host: "^1.0.0" },
    });
    // `host` declares a caret peer on `lib`, so a major bump of `lib` is incompatible.
    const hostPkg = graph.getPackage("host");
    if (hostPkg) hostPkg.peerDependencies = { lib: "^1.0.0" };
    const engine = new ResolutionEngine(graph);
    const ranked = engine.generatePlans([
      dependencyFinding("lib", "1.0.0", ["2.0.0"]),
      dependencyFinding("other", "1.0.0", ["1.0.5"]),
    ]);
    expect(ranked.map((p) => [p.id, p.compatibility])).toEqual([
      ["plan-other-candidate", "Unknown"],
      ["plan-lib-candidate", "Incompatible"],
    ]);
  });

  it("orders unknown plans by risk when compatibility ties", () => {
    const engine = new ResolutionEngine(graphFor({ dependencies: { a: "^1.0.0", b: "^1.0.0" } }));
    const ranked = engine.generatePlans([
      dependencyFinding("a", "1.0.0", ["2.0.0"]),
      dependencyFinding("b", "1.0.0", ["1.0.1"]),
    ]);
    expect(ranked.map((p) => [p.id, p.risk])).toEqual([
      ["plan-b-candidate", "Low"],
      ["plan-a-candidate", "Medium"],
    ]);
  });
});
