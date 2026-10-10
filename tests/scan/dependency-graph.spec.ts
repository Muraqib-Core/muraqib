import { afterEach, beforeEach, describe, expect, test } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DependencyGraph } from "../../src/scan/core/resolution/dependency-graph.js";

describe("DependencyGraph", () => {
  let dir = "";

  const writePkg = (pkg: object): void =>
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify(pkg));
  const install = (name: string, meta: object): void => {
    const p = path.join(dir, "node_modules", name);
    fs.mkdirSync(p, { recursive: true });
    fs.writeFileSync(path.join(p, "package.json"), JSON.stringify(meta));
  };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "muraqib-graph-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  describe("construction", () => {
    test("throws when package.json is missing or invalid", () => {
      expect(() => new DependencyGraph(dir)).toThrow("No package.json found");
      fs.writeFileSync(path.join(dir, "package.json"), "{ bad");
      expect(() => new DependencyGraph(dir)).toThrow("Failed to parse package.json");
    });

    test("defaults to npm without hints", () => {
      writePkg({});
      const graph = new DependencyGraph(dir);
      expect(graph.packageManager).toBe("npm");
      expect(graph.lockfilePath).toBeUndefined();
    });

    test("uses the declared packageManager field", () => {
      writePkg({ packageManager: "yarn@4.0.0" });
      expect(new DependencyGraph(dir).packageManager).toBe("yarn");
    });

    test("ignores an unsupported packageManager and falls back to lockfiles", () => {
      writePkg({ packageManager: "deno@1" });
      fs.writeFileSync(path.join(dir, "pnpm-lock.yaml"), "");
      const graph = new DependencyGraph(dir);
      expect(graph.packageManager).toBe("pnpm");
      expect(graph.lockfilePath).toBe(path.join(dir, "pnpm-lock.yaml"));
    });

    test.each([
      ["yarn.lock", "yarn"],
      ["bun.lockb", "bun"],
    ])("detects %s", (file, manager) => {
      writePkg({});
      fs.writeFileSync(path.join(dir, file), "");
      expect(new DependencyGraph(dir).packageManager).toBe(manager);
    });

    test("records engines and declared packages from every section", () => {
      writePkg({
        engines: { node: ">=18" },
        dependencies: { a: "^1.0.0" },
        devDependencies: { b: "~2.0.0", a: "9.9.9" },
        peerDependencies: { c: "3.0.0" },
        optionalDependencies: { d: "4.0.0" },
      });
      install("a", { version: "1.2.3", engines: { node: ">=14" }, dependencies: { x: "1" } });
      const graph = new DependencyGraph(dir);
      expect(graph.projectEngines).toEqual({ node: ">=18" });
      expect(graph.declaredPackages.size).toBe(4);
      const a = graph.getPackage("a");
      expect(a).toMatchObject({
        declaredVersion: "^1.0.0",
        installedVersion: "1.2.3",
        dependencyType: "dependencies",
        dependencies: { x: "1" },
      });
      expect(graph.getPackage("b")?.installedVersion).toBe("2.0.0");
      expect(graph.getPackage("zzz")).toBeUndefined();
    });
  });

  describe("getInstalledMeta", () => {
    test("returns null for missing or unparsable installed packages", () => {
      writePkg({});
      const graph = new DependencyGraph(dir);
      expect(graph.getInstalledMeta("nope")).toBeNull();
      const p = path.join(dir, "node_modules", "bad");
      fs.mkdirSync(p, { recursive: true });
      fs.writeFileSync(path.join(p, "package.json"), "{ bad");
      expect(graph.getInstalledMeta("bad")).toBeNull();
    });
  });

  describe("getRelatedPackages", () => {
    test("pairs prisma and react families only when both are declared", () => {
      writePkg({
        dependencies: { prisma: "1.0.0", "@prisma/client": "1.0.0", react: "18.0.0", "react-dom": "18.0.0" },
      });
      const graph = new DependencyGraph(dir);
      expect(graph.getRelatedPackages("prisma")).toEqual(["@prisma/client"]);
      expect(graph.getRelatedPackages("@prisma/client")).toEqual(["prisma"]);
      expect(graph.getRelatedPackages("react")).toEqual(["react-dom"]);
      expect(graph.getRelatedPackages("react-dom")).toEqual(["react"]);
      expect(graph.getRelatedPackages("lodash")).toEqual([]);
    });

    test("returns nothing when the partner is not declared", () => {
      writePkg({ dependencies: { prisma: "1.0.0", react: "18.0.0" } });
      const graph = new DependencyGraph(dir);
      expect(graph.getRelatedPackages("prisma")).toEqual([]);
      expect(graph.getRelatedPackages("react")).toEqual([]);
    });
  });

  describe("createFingerprint", () => {
    test("is stable and changes when the manifest or a lockfile changes", () => {
      writePkg({ dependencies: { a: "1.0.0" } });
      const graph = new DependencyGraph(dir);
      const first = graph.createFingerprint();
      expect(graph.createFingerprint()).toBe(first);
      writePkg({ dependencies: { a: "2.0.0" } });
      const second = graph.createFingerprint();
      expect(second).not.toBe(first);
      fs.writeFileSync(path.join(dir, "package-lock.json"), "{}");
      expect(graph.createFingerprint()).not.toBe(second);
    });
  });

  describe("checkCompatibility", () => {
    test("is Unknown for undeclared packages", () => {
      writePkg({});
      expect(new DependencyGraph(dir).checkCompatibility("x", "1.0.0")).toEqual({
        status: "Unknown",
        reason: "Package not declared in project",
      });
    });

    test("is Incompatible when the package engine needs a newer Node", () => {
      writePkg({ dependencies: { a: "1.0.0" } });
      install("a", { version: "1.0.0", engines: { node: ">=999" } });
      const result = new DependencyGraph(dir).checkCompatibility("a", "1.0.1");
      expect(result.status).toBe("Incompatible");
      expect(result.reason).toContain(">=999");
    });

    test("accepts an engine requirement the current Node satisfies", () => {
      writePkg({ dependencies: { a: "1.0.0" } });
      install("a", { version: "1.0.0", engines: { node: ">=1" } });
      expect(new DependencyGraph(dir).checkCompatibility("a", "1.0.1").status).toBe("Unknown");
    });

    test("is Incompatible when a caret peer requirement excludes the target major", () => {
      writePkg({ dependencies: { host: "1.0.0", plugin: "1.0.0" } });
      install("host", { version: "1.0.0", peerDependencies: { plugin: "^1.0.0" } });
      const graph = new DependencyGraph(dir);
      const result = graph.checkCompatibility("plugin", "2.0.0");
      expect(result.status).toBe("Incompatible");
      expect(result.reason).toContain("host requires peer dependency plugin@^1.0.0");
      expect(graph.checkCompatibility("plugin", "1.5.0").status).toBe("Unknown");
    });

    test("ignores non-caret peer requirements", () => {
      writePkg({ dependencies: { host: "1.0.0", plugin: "1.0.0" } });
      install("host", { version: "1.0.0", peerDependencies: { plugin: "~1.0.0" } });
      expect(new DependencyGraph(dir).checkCompatibility("plugin", "2.0.0").status).toBe("Unknown");
    });
  });
});
