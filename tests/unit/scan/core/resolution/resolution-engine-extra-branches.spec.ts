import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DependencyGraph } from "../../../../../src/scan/core/resolution/dependency-graph.js";
import { ResolutionEngine } from "../../../../../src/scan/core/resolution/resolution-engine.js";
import { createScanIssue } from "../../../../../src/scan/core/findings/finding.js";
import type { ScanIssue } from "../../../../../src/scan/core/findings/finding.js";

const tmpDirs: string[] = [];

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function graphFor(manifest: Record<string, unknown>): DependencyGraph {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "muraqib-resolution-extra-"));
  tmpDirs.push(dir);
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify(manifest), "utf8");
  return new DependencyGraph(dir);
}

function finding(pkg: string, installed: string, fixed: string[]): ScanIssue {
  const problem: NonNullable<ScanIssue["dependencyProblem"]> = {
    package: pkg,
    installedVersion: installed,
    declaredVersion: `^${installed}`,
    dependencyType: "dependencies",
    advisoryCount: 1,
    advisories: [],
    affectedRanges: [],
    fixedVersions: fixed,
  };
  return createScanIssue({
    id: `osv-${pkg}`,
    title: `Dependency Problem: ${pkg}`,
    message: `${pkg} is vulnerable`,
    severity: "high",
    category: "security",
    source: "osv",
    file: "package.json",
    key: pkg,
    dependencyProblem: problem,
  });
}

describe("ResolutionEngine extra branches", () => {
  it("skips findings whose only fixed version is an empty string", () => {
    const engine = new ResolutionEngine(graphFor({ dependencies: { a: "^1.0.0" } }));
    expect(engine.generatePlans([finding("a", "1.0.0", [""])])).toEqual([]);
  });

  it("treats an empty installed version as major 0", () => {
    const engine = new ResolutionEngine(graphFor({ dependencies: { a: "^1.0.0" } }));
    const [plan] = engine.generatePlans([finding("a", "", ["0.5.0"])]);
    expect(plan?.risk).toBe("Low");
  });

  it("uses the declared version for coordinated packages without an installed version", () => {
    const engine = new ResolutionEngine(
      graphFor({ dependencies: { react: "^18.0.0", "react-dom": "^18.0.0" } }),
    );
    const plans = engine.generatePlans([finding("react-dom", "18.0.0", ["18.2.0"])]);
    const coordinated = plans.find((p) => p.id === "plan-react-dom-coordinated");
    expect(coordinated?.changes).toHaveLength(2);
    expect(coordinated?.changes[1]?.packageName).toBe("react");
  });

  it("returns no plans for an empty finding list", () => {
    const engine = new ResolutionEngine(graphFor({}));
    expect(engine.generatePlans([])).toEqual([]);
  });
});
