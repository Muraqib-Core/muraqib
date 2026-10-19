import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { DependencyGraph } from "../../src/scan/core/resolution/dependency-graph.js";
import { ResolutionApplier } from "../../src/scan/core/resolution/resolution-applier.js";
import { runVerification } from "../../src/scan/core/resolution/resolution-verifier.js";
import type {
  PackageChange,
  ResolutionPlan,
} from "../../src/scan/core/resolution/resolution-plan.js";

vi.mock("node:child_process", () => ({ execFileSync: vi.fn() }));
vi.mock("../../src/scan/core/resolution/resolution-verifier.js", () => ({
  runVerification: vi.fn(),
}));

const exec = vi.mocked(execFileSync);
const verify = vi.mocked(runVerification);
const tmpDirs: string[] = [];

beforeEach(() => {
  exec.mockReset();
  verify.mockReset();
  verify.mockResolvedValue([{ step: "dependencies", passed: true }]);
});

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function project(
  manifest: Record<string, unknown>,
  files: Record<string, string> = {}
): { dir: string; graph: DependencyGraph } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "muraqib-applier-"));
  tmpDirs.push(dir);
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify(manifest), "utf8");
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(dir, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, "utf8");
  }
  return { dir, graph: new DependencyGraph(dir) };
}

function planFor(changes: PackageChange[], baseFingerprint?: string): ResolutionPlan {
  const plan: ResolutionPlan = {
    id: "plan",
    title: "Plan",
    planName: "plan",
    reason: "test",
    changes,
    findingsResolved: [],
    securityImpact: "none",
    compatibility: "Compatible",
    risk: "Low",
    affectedPackages: changes.map((c) => c.packageName),
  };
  if (baseFingerprint !== undefined) plan.baseFingerprint = baseFingerprint;
  return plan;
}

function change(packageName: string, currentVersion: string, targetVersion: string): PackageChange {
  return { packageName, currentVersion, targetVersion, direction: "upgrade" };
}

function readManifest(dir: string): Record<string, Record<string, string>> {
  return JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")) as Record<
    string,
    Record<string, string>
  >;
}

describe("ResolutionApplier.apply stale protection", () => {
  it("rejects without touching anything when not approved", async () => {
    const { graph } = project({ dependencies: { a: "1.0.0" } });
    const result = await new ResolutionApplier(graph).apply(planFor([]), "rejected");
    expect(result.status).toBe("rejected");
    expect(exec).not.toHaveBeenCalled();
  });

  it("reports stale when package.json was removed", async () => {
    const { dir, graph } = project({ dependencies: { a: "1.0.0" } });
    fs.rmSync(path.join(dir, "package.json"));
    const result = await new ResolutionApplier(graph).apply(planFor([]), "approved");
    expect(result.status).toBe("stale");
    expect(result.message).toContain("no longer exists");
  });

  it("reports stale when the fingerprint changed", async () => {
    const { graph } = project({ dependencies: { a: "1.0.0" } });
    const result = await new ResolutionApplier(graph).apply(
      planFor([change("a", "1.0.0", "1.1.0")], "not-the-fingerprint"),
      "approved"
    );
    expect(result.status).toBe("stale");
    expect(result.message).toContain("configuration changed");
  });

  it("passes the fingerprint check when it matches", async () => {
    const { dir, graph } = project({ dependencies: { a: "1.0.0" } });
    const plan = planFor([change("a", "1.0.0", "1.1.0")], graph.createFingerprint());
    const result = await new ResolutionApplier(graph).apply(plan, "approved");
    expect(result.status).toBe("applied");
    expect(readManifest(dir)["dependencies"]?.["a"]).toBe("1.1.0");
  });

  it("reports stale when package.json is unparseable", async () => {
    const { dir, graph } = project({ dependencies: { a: "1.0.0" } });
    fs.writeFileSync(path.join(dir, "package.json"), "{ nope", "utf8");
    const result = await new ResolutionApplier(graph).apply(planFor([]), "approved");
    expect(result.status).toBe("stale");
    expect(result.message).toContain("Unable to parse");
  });

  it("reports stale when the package is no longer declared", async () => {
    const { graph } = project({ dependencies: { a: "1.0.0" } });
    const result = await new ResolutionApplier(graph).apply(
      planFor([change("ghost", "1.0.0", "2.0.0")]),
      "approved"
    );
    expect(result.status).toBe("stale");
    expect(result.message).toContain("'ghost'");
  });

  it("reports stale when the installed version differs from the plan", async () => {
    const { graph } = project(
      { dependencies: { a: "^1.0.0" } },
      { "node_modules/a/package.json": JSON.stringify({ name: "a", version: "1.0.5" }) }
    );
    const result = await new ResolutionApplier(graph).apply(
      planFor([change("a", "1.0.0", "1.1.0")]),
      "approved"
    );
    expect(result.status).toBe("stale");
    expect(result.message).toContain("changed from 1.0.0 to 1.0.5");
  });

  it("accepts a matching installed version", async () => {
    const { graph } = project(
      { dependencies: { a: "^1.0.0" } },
      { "node_modules/a/package.json": JSON.stringify({ name: "a", version: "1.0.0" }) }
    );
    const result = await new ResolutionApplier(graph).apply(
      planFor([change("a", "1.0.0", "1.1.0")]),
      "approved"
    );
    expect(result.status).toBe("applied");
  });

  it("reports stale when not installed and the declared version differs", async () => {
    const { graph } = project({ dependencies: { a: "~1.2.0" } });
    const result = await new ResolutionApplier(graph).apply(
      planFor([change("a", "1.0.0", "1.1.0")]),
      "approved"
    );
    expect(result.status).toBe("stale");
    expect(result.message).toContain("Declared version for 'a' (1.2.0)");
  });
});

describe("ResolutionApplier.apply mutation", () => {
  it("preserves prefixes across all dependency sections", async () => {
    const { dir, graph } = project({
      dependencies: { a: "^1.0.0" },
      devDependencies: { b: "~2.0.0" },
      peerDependencies: { c: "3.0.0" },
      optionalDependencies: { d: "4.0.0-beta.1" },
    });
    const result = await new ResolutionApplier(graph).apply(
      planFor([
        change("a", "1.0.0", "1.5.0"),
        change("b", "2.0.0", "2.5.0"),
        change("c", "3.0.0", "3.5.0"),
        change("d", "4.0.0-beta.1", "4.1.0"),
      ]),
      "approved"
    );
    expect(result.status).toBe("applied");
    const manifest = readManifest(dir);
    expect(manifest["dependencies"]?.["a"]).toBe("^1.5.0");
    expect(manifest["devDependencies"]?.["b"]).toBe("~2.5.0");
    expect(manifest["peerDependencies"]?.["c"]).toBe("3.5.0");
    expect(manifest["optionalDependencies"]?.["d"]).toBe("4.1.0");
    expect(exec).toHaveBeenCalledWith("npm", ["install"], expect.objectContaining({ cwd: dir }));
  });

  it("fails when the declaration is not a simple semver", async () => {
    const { dir, graph } = project({ dependencies: { a: ">=1.0.0 <2.0.0" } });
    const result = await new ResolutionApplier(graph).apply(
      planFor([change("a", ">=1.0.0 <2.0.0", "1.5.0")]),
      "approved"
    );
    expect(result.status).toBe("failed");
    expect(result.message).toContain("Failed to update package.json");
    expect(result.message).toContain("Unsupported version declaration");
    expect(readManifest(dir)["dependencies"]?.["a"]).toBe(">=1.0.0 <2.0.0");
    expect(exec).not.toHaveBeenCalled();
  });
});

describe("ResolutionApplier.apply rollback", () => {
  it("restores package.json and the lockfile when the install fails", async () => {
    const { dir, graph } = project(
      { dependencies: { a: "1.0.0" } },
      { "package-lock.json": "original-lock" }
    );
    const originalManifest = fs.readFileSync(path.join(dir, "package.json"), "utf8");
    exec.mockImplementation(() => {
      fs.writeFileSync(path.join(dir, "package-lock.json"), "corrupted", "utf8");
      throw new Error("install exploded");
    });
    const result = await new ResolutionApplier(graph).apply(
      planFor([change("a", "1.0.0", "1.1.0")]),
      "approved"
    );
    expect(result.status).toBe("failed");
    expect(result.rolledBack).toBe(true);
    expect(result.message).toContain("install exploded");
    expect(fs.readFileSync(path.join(dir, "package.json"), "utf8")).toBe(originalManifest);
    expect(fs.readFileSync(path.join(dir, "package-lock.json"), "utf8")).toBe("original-lock");
  });

  it("stringifies non-Error install failures and removes a lockfile created by the install", async () => {
    const { dir, graph } = project({ dependencies: { a: "1.0.0" } });
    exec.mockImplementation(() => {
      fs.writeFileSync(path.join(dir, "package-lock.json"), "new", "utf8");
      throw "plain string failure";
    });
    const result = await new ResolutionApplier(graph).apply(
      planFor([change("a", "1.0.0", "1.1.0")]),
      "approved"
    );
    expect(result.rolledBack).toBe(true);
    expect(result.message).toContain("plain string failure");
    expect(fs.existsSync(path.join(dir, "package-lock.json"))).toBe(false);
  });

  it("tolerates a missing lockfile that was never created when restoring", async () => {
    const { dir, graph } = project({ dependencies: { a: "1.0.0" } });
    exec.mockImplementation(() => {
      throw new Error("boom");
    });
    const result = await new ResolutionApplier(graph).apply(
      planFor([change("a", "1.0.0", "1.1.0")]),
      "approved"
    );
    expect(result.rolledBack).toBe(true);
    expect(fs.existsSync(path.join(dir, "package-lock.json"))).toBe(false);
  });

  it.each([
    ["pnpm", "pnpm@9.0.0", "pnpm-lock.yaml"],
    ["yarn", "yarn@4.0.0", "yarn.lock"],
    ["bun", "bun@1.0.0", "bun.lockb"],
  ])("derives the expected lockfile for %s", async (manager, declared, lockfile) => {
    const { dir, graph } = project({
      packageManager: declared,
      dependencies: { a: "1.0.0" },
    });
    exec.mockImplementation(() => {
      fs.writeFileSync(path.join(dir, lockfile), "new", "utf8");
      throw new Error("fail");
    });
    const result = await new ResolutionApplier(graph).apply(
      planFor([change("a", "1.0.0", "1.1.0")]),
      "approved"
    );
    expect(exec).toHaveBeenCalledWith(manager, ["install"], expect.any(Object));
    expect(result.rolledBack).toBe(true);
    expect(fs.existsSync(path.join(dir, lockfile))).toBe(false);
  });

  it("rolls back and reports failed verification steps", async () => {
    const { dir, graph } = project(
      { dependencies: { a: "1.0.0" } },
      { "package-lock.json": "lock" }
    );
    const originalManifest = fs.readFileSync(path.join(dir, "package.json"), "utf8");
    verify.mockResolvedValue([
      { step: "dependencies", passed: true },
      { step: "tests", passed: false, message: "2 failing" },
    ]);
    const result = await new ResolutionApplier(graph).apply(
      planFor([change("a", "1.0.0", "1.1.0")]),
      "approved"
    );
    expect(result.status).toBe("failed");
    expect(result.rolledBack).toBe(true);
    expect(result.message).toContain("tests (2 failing)");
    expect(result.verificationResults).toHaveLength(2);
    expect(fs.readFileSync(path.join(dir, "package.json"), "utf8")).toBe(originalManifest);
  });
});
