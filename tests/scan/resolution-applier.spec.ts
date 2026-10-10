import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

vi.mock("node:child_process", () => ({ execFileSync: vi.fn() }));
vi.mock("../../src/scan/scanners/dependency/osv-engine.js", () => ({
  OsvScanner: vi.fn(),
}));
vi.mock("../../src/scan/scanners/compatibility/compatibility-engine.js", () => ({
  CompatibilityEngine: vi.fn(),
}));

import { execFileSync } from "node:child_process";
import { OsvScanner } from "../../src/scan/scanners/dependency/osv-engine.js";
import { CompatibilityEngine } from "../../src/scan/scanners/compatibility/compatibility-engine.js";
import { DependencyGraph } from "../../src/scan/core/resolution/dependency-graph.js";
import { ResolutionApplier } from "../../src/scan/core/resolution/resolution-applier.js";
import type { ResolutionPlan } from "../../src/scan/core/resolution/resolution-plan.js";

const exec = vi.mocked(execFileSync);

interface ScannerStub {
  supports: () => boolean;
  scan: () => Promise<unknown>;
}

function stubOsv(stub: ScannerStub): void {
  vi.mocked(OsvScanner).mockImplementation(function () {
    return stub as never;
  });
}
function stubCompat(stub: ScannerStub): void {
  vi.mocked(CompatibilityEngine).mockImplementation(function () {
    return stub as never;
  });
}
const passing = (): ScannerStub => ({
  supports: () => true,
  scan: async () => ({ scanner: "x", status: "success", findings: [] }),
});

describe("ResolutionApplier (mocked package manager)", () => {
  let dir = "";
  let pkgFile = "";

  const plan = (overrides: Partial<ResolutionPlan> = {}): ResolutionPlan => ({
    id: "p",
    title: "t",
    planName: "t",
    reason: "r",
    changes: [
      { packageName: "lodash", currentVersion: "4.17.0", targetVersion: "4.17.21", direction: "upgrade" },
    ],
    findingsResolved: [],
    securityImpact: "",
    compatibility: "Compatible",
    risk: "Low",
    affectedPackages: ["lodash"],
    ...overrides,
  });

  const writePkg = (pkg: object): void => fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, 2));
  const applier = (): ResolutionApplier => new ResolutionApplier(new DependencyGraph(dir));
  const readPkg = (): { dependencies?: Record<string, string> } =>
    JSON.parse(fs.readFileSync(pkgFile, "utf8"));

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "muraqib-applier-"));
    pkgFile = path.join(dir, "package.json");
    writePkg({ name: "app", dependencies: { lodash: "^4.17.0" } });
    exec.mockReset();
    exec.mockReturnValue(Buffer.from(""));
    stubOsv(passing());
    stubCompat(passing());
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("applies the plan and keeps the range prefix", async () => {
    const result = await applier().apply(plan(), "approved");
    expect(result.status).toBe("applied");
    expect(readPkg().dependencies?.lodash).toBe("^4.17.21");
    expect(exec).toHaveBeenCalledWith("npm", ["install"], expect.any(Object));
    const steps = result.verificationResults?.map((r) => r.step);
    expect(steps).toEqual(
      expect.arrayContaining(["dependencies", "typecheck", "tests", "securityScan", "compatibilityScan"])
    );
  });

  test("reports stale when package.json is gone", async () => {
    const a = applier();
    fs.unlinkSync(pkgFile);
    const result = await a.apply(plan(), "approved");
    expect(result.status).toBe("stale");
    expect(result.message).toContain("no longer exists");
  });

  test("reports stale when package.json becomes unparsable", async () => {
    const a = applier();
    fs.writeFileSync(pkgFile, "{ nope");
    expect((await a.apply(plan(), "approved")).message).toContain("Unable to parse");
  });

  test("reports stale when the package is no longer declared", async () => {
    const a = applier();
    writePkg({ name: "app", dependencies: {} });
    expect((await a.apply(plan(), "approved")).message).toContain("no longer declared");
  });

  test("reports stale when the declared version drifted (no installed copy)", async () => {
    const a = applier();
    writePkg({ name: "app", dependencies: { lodash: "^4.16.0" } });
    expect((await a.apply(plan(), "approved")).message).toContain("does not match planned version");
  });

  test("reports stale when the installed version changed", async () => {
    const nm = path.join(dir, "node_modules", "lodash");
    fs.mkdirSync(nm, { recursive: true });
    fs.writeFileSync(path.join(nm, "package.json"), JSON.stringify({ version: "4.99.0" }));
    const result = await applier().apply(plan(), "approved");
    expect(result.status).toBe("stale");
    expect(result.message).toContain("changed from 4.17.0 to 4.99.0");
  });

  test("reports stale when the fingerprint no longer matches", async () => {
    const result = await applier().apply(plan({ baseFingerprint: "deadbeef" }), "approved");
    expect(result.status).toBe("stale");
    expect(result.message).toContain("changed");
  });

  test("falls back to adding a missing package to dependencies", async () => {
    writePkg({ name: "app", dependencies: { lodash: "^4.17.0" } });
    const a = applier();
    const result = await a.apply(
      plan({
        changes: [
          { packageName: "lodash", currentVersion: "4.17.0", targetVersion: "4.17.21", direction: "upgrade" },
        ],
      }),
      "approved"
    );
    expect(result.status).toBe("applied");
  });

  test("rolls back and reports failure when the package manager fails", async () => {
    const before = fs.readFileSync(pkgFile, "utf8");
    exec.mockImplementation(() => {
      throw new Error("registry down");
    });
    const result = await applier().apply(plan(), "approved");
    expect(result.status).toBe("failed");
    expect(result.rolledBack).toBe(true);
    expect(result.message).toContain("registry down");
    expect(fs.readFileSync(pkgFile, "utf8")).toBe(before);
  });

  test("removes a lockfile that did not exist before a failed install", async () => {
    const lock = path.join(dir, "package-lock.json");
    exec.mockImplementation(() => {
      fs.writeFileSync(lock, "{}");
      throw new Error("fail");
    });
    await applier().apply(plan(), "approved");
    expect(fs.existsSync(lock)).toBe(false);
  });

  test("restores an existing lockfile after a failed install", async () => {
    const lock = path.join(dir, "package-lock.json");
    fs.writeFileSync(lock, "original");
    exec.mockImplementation(() => {
      fs.writeFileSync(lock, "changed");
      throw new Error("fail");
    });
    await applier().apply(plan(), "approved");
    expect(fs.readFileSync(lock, "utf8")).toBe("original");
  });

  test("fails and rolls back when mutation hits a complex range", async () => {
    writePkg({ name: "app", dependencies: { lodash: ">=4 <5" } });
    const a = applier();
    const result = await a.apply(
      plan({ changes: [{ packageName: "lodash", currentVersion: ">=4 <5", targetVersion: "4.17.21", direction: "upgrade" }] }),
      "approved"
    );
    expect(result.status).toBe("failed");
    expect(result.message).toContain("Unsupported version declaration");
  });

  test("runs typecheck and tests with the right commands and rolls back on failure", async () => {
    fs.writeFileSync(path.join(dir, "tsconfig.json"), "{}");
    writePkg({ name: "app", dependencies: { lodash: "^4.17.0" }, scripts: { test: "vitest" } });
    const before = fs.readFileSync(pkgFile, "utf8");
    exec.mockImplementation((_cmd, args) => {
      if (args?.[0] === "run") {
        const err = Object.assign(new Error("tests broke"), { code: "ETIMEDOUT" });
        throw err;
      }
      return Buffer.from("");
    });
    const result = await applier().apply(plan(), "approved");
    expect(exec).toHaveBeenCalledWith("npm", ["exec", "--", "tsc", "--noEmit"], expect.any(Object));
    expect(result.status).toBe("failed");
    expect(result.rolledBack).toBe(true);
    const tests = result.verificationResults?.find((r) => r.step === "tests");
    expect(tests?.status).toBe("timed-out");
    expect(fs.readFileSync(pkgFile, "utf8")).toBe(before);
  });

  test("classifies a missing binary as unavailable and plain errors as failed", async () => {
    fs.writeFileSync(path.join(dir, "tsconfig.json"), "{}");
    exec.mockImplementation((_cmd, args) => {
      if (args?.[0] === "install") return Buffer.from("");
      throw Object.assign(new Error("no tsc"), { code: "ENOENT" });
    });
    const result = await applier().apply(plan(), "approved");
    const typecheck = result.verificationResults?.find((r) => r.step === "typecheck");
    expect(typecheck?.status).toBe("unavailable");

    exec.mockImplementation((_cmd, args) => {
      if (args?.[0] === "install") return Buffer.from("");
      throw new Error("type error");
    });
    const second = await applier().apply(plan(), "approved");
    expect(second.verificationResults?.find((r) => r.step === "typecheck")?.status).toBe("failed");
  });

  test("treats the default npm placeholder test script as not runnable", async () => {
    writePkg({
      name: "app",
      dependencies: { lodash: "^4.17.0" },
      scripts: { test: 'echo "Error: no test specified" && exit 1' },
    });
    const result = await applier().apply(plan(), "approved");
    expect(result.verificationResults?.find((r) => r.step === "tests")?.status).toBe("skipped");
  });

  test("fails verification when the security scan is not successful", async () => {
    stubOsv({
      supports: () => true,
      scan: async () => ({ scanner: "osv", status: "unavailable", findings: [], error: "offline" }),
    });
    const result = await applier().apply(plan(), "approved");
    const step = result.verificationResults?.find((r) => r.step === "securityScan");
    expect(step).toMatchObject({ passed: false, status: "unavailable", message: "offline" });
    expect(result.status).toBe("failed");
  });

  test("marks a non-success scan as an infrastructure error", async () => {
    stubOsv({
      supports: () => true,
      scan: async () => ({ scanner: "osv", status: "partial", findings: [] }),
    });
    const result = await applier().apply(plan(), "approved");
    const step = result.verificationResults?.find((r) => r.step === "securityScan");
    expect(step?.status).toBe("infrastructure-error");
    expect(step?.message).toContain("partial");
  });

  test("fails verification when the changed package is still vulnerable", async () => {
    stubOsv({
      supports: () => true,
      scan: async () => ({
        scanner: "osv",
        status: "success",
        findings: [{ key: "lodash" }, { key: "other" }],
      }),
    });
    const result = await applier().apply(plan(), "approved");
    const step = result.verificationResults?.find((r) => r.step === "securityScan");
    expect(step?.message).toContain("1 unresolved advisories");
    expect(result.rolledBack).toBe(true);
  });

  test("captures a throwing security scanner as an infrastructure error", async () => {
    stubOsv({
      supports: () => true,
      scan: async () => {
        throw new Error("scanner exploded");
      },
    });
    const result = await applier().apply(plan(), "approved");
    const step = result.verificationResults?.find((r) => r.step === "securityScan");
    expect(step?.message).toContain("scanner exploded");
  });

  test("reports compatibility conflicts, scan errors and thrown errors", async () => {
    stubCompat({
      supports: () => true,
      scan: async () => ({ scanner: "c", status: "success", findings: [{}, {}] }),
    });
    let result = await applier().apply(plan(), "approved");
    expect(result.verificationResults?.find((r) => r.step === "compatibilityScan")?.message).toContain(
      "2 compatibility conflicts"
    );

    stubCompat({
      supports: () => true,
      scan: async () => ({ scanner: "c", status: "unavailable", findings: [], error: "no data" }),
    });
    result = await applier().apply(plan(), "approved");
    expect(result.verificationResults?.find((r) => r.step === "compatibilityScan")?.status).toBe("unavailable");

    stubCompat({
      supports: () => true,
      scan: async () => ({ scanner: "c", status: "failed", findings: [] }),
    });
    result = await applier().apply(plan(), "approved");
    expect(result.verificationResults?.find((r) => r.step === "compatibilityScan")?.status).toBe(
      "infrastructure-error"
    );

    stubCompat({
      supports: () => true,
      scan: async () => {
        throw new Error("compat boom");
      },
    });
    result = await applier().apply(plan(), "approved");
    expect(result.verificationResults?.find((r) => r.step === "compatibilityScan")?.message).toContain(
      "compat boom"
    );
  });

  test("skips scanners that do not support the project", async () => {
    stubOsv({ supports: () => false, scan: async () => ({}) });
    stubCompat({ supports: () => false, scan: async () => ({}) });
    const result = await applier().apply(plan(), "approved");
    const steps = result.verificationResults?.map((r) => r.step);
    expect(steps).not.toContain("securityScan");
    expect(steps).not.toContain("compatibilityScan");
    expect(result.status).toBe("applied");
  });

  test("uses the package-manager specific typecheck command for pnpm and bun", async () => {
    fs.writeFileSync(path.join(dir, "tsconfig.json"), "{}");
    writePkg({ name: "app", packageManager: "pnpm@9.0.0", dependencies: { lodash: "^4.17.0" } });
    await applier().apply(plan(), "approved");
    expect(exec).toHaveBeenCalledWith("pnpm", ["exec", "tsc", "--noEmit"], expect.any(Object));

    writePkg({ name: "app", packageManager: "bun@1.0.0", dependencies: { lodash: "^4.17.0" } });
    await applier().apply(plan(), "approved");
    expect(exec).toHaveBeenCalledWith("bun", ["x", "tsc", "--noEmit"], expect.any(Object));
  });
});
