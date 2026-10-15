import { afterEach, beforeEach, describe, expect, test } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DependencyGuard, performDependencyAudit } from "./dependency-guard.js";
import { extractImportSpecifiers, findCycles } from "./helpers/import-graph.js";

describe("dependency-guard (import graph, lock files, patterns)", () => {
  let dir = "";

  const write = (rel: string, content: string): void => {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "muraqib-depguard2-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  describe("cycles", () => {
    test("detects a cycle through .js specifiers", () => {
      write("src/a.ts", `import { b } from "./b.js";\nexport const a = b;\n`);
      write("src/b.ts", `import { a } from "./a.js";\nexport const b = a;\n`);
      const result = performDependencyAudit(dir);
      expect(result.circularDependencies).toEqual([["src/a.ts", "src/b.ts", "src/a.ts"]]);
    });

    test("detects a cycle through a multi-line import", () => {
      write("src/a.ts", `import {\n  x,\n  y,\n} from "./b.js";\nexport const a = 1;\n`);
      write("src/b.ts", `import type {\n  a\n} from "./a.js";\nexport const x = 1;\n`);
      expect(performDependencyAudit(dir).circularDependencies).toHaveLength(1);
    });

    test("sees side-effect, export-from and dynamic import edges", () => {
      write("src/a.ts", `import "./b.js";\n`);
      write("src/b.ts", `export * from "./c.js";\n`);
      write("src/c.ts", `export const c = () => import("./a.js");\n`);
      expect(performDependencyAudit(dir).circularDependencies).toEqual([
        ["src/a.ts", "src/b.ts", "src/c.ts", "src/a.ts"],
      ]);
    });

    test("resolves directory index through .js specifier of a folder", () => {
      write("src/a.ts", `import { b } from "./lib";\nexport const a = b;\n`);
      write("src/lib/index.ts", `import { a } from "../a.js";\nexport const b = a;\n`);
      expect(performDependencyAudit(dir).circularDependencies).toHaveLength(1);
    });

    test("does not report a false cycle for a diamond", () => {
      write("src/a.ts", `import "./b.js";\nimport "./c.js";\n`);
      write("src/b.ts", `import "./d.js";\n`);
      write("src/c.ts", `import "./d.js";\n`);
      write("src/d.ts", `export const d = 1;\n`);
      expect(performDependencyAudit(dir).circularDependencies).toEqual([]);
    });

    test("ignores imports that appear in comments", () => {
      write("src/a.ts", `// import "./b.js";\n/* import x from "./b.js" */\nexport const a = 1;\n`);
      write("src/b.ts", `import "./a.js";\n`);
      expect(performDependencyAudit(dir).circularDependencies).toEqual([]);
    });

    test("reports each cycle once and handles deep graphs without recursion", () => {
      const graph = new Map<string, Set<string>>();
      const size = 20000;
      for (let i = 0; i < size; i++) graph.set(`n${i}`, new Set([`n${(i + 1) % size}`]));
      const cycles = findCycles(graph);
      expect(cycles).toHaveLength(1);
      expect(cycles[0]).toHaveLength(size + 1);

      const twoWay = new Map<string, Set<string>>([
        ["b", new Set(["a"])],
        ["a", new Set(["b"])],
      ]);
      expect(findCycles(twoWay)).toEqual([["a", "b", "a"]]);
    });
  });

  describe("extractImportSpecifiers", () => {
    test("covers all import forms and skips comments", () => {
      const source = [
        `import a from "./a";`,
        `import * as ns from './ns';`,
        `import type { T } from "./types";`,
        `import "./side";`,
        `export { x } from "./x";`,
        `export * from "./star";`,
        `export * as y from "./y";`,
        `const z = await import("./dyn");`,
        `// import q from "./commented"`,
        `/* export * from "./block" */`,
        `const s = "import r from './in-string'";`,
      ].join("\n");
      expect(extractImportSpecifiers(source).sort()).toEqual(
        ["./a", "./dyn", "./ns", "./side", "./star", "./types", "./x", "./y"].sort()
      );
    });
  });

  describe("lock files", () => {
    beforeEach(() => write("package.json", "{}"));

    test("npm lockfile v3 duplicates, including scoped and nested", () => {
      write(
        "package-lock.json",
        JSON.stringify({
          lockfileVersion: 3,
          packages: {
            "": { name: "root", version: "1.0.0" },
            "node_modules/left-pad": { version: "1.0.0" },
            "node_modules/foo/node_modules/left-pad": { version: "2.0.0" },
            "node_modules/@s/pkg": { version: "1.0.0" },
            "node_modules/x/node_modules/@s/pkg": { version: "1.1.0" },
            "node_modules/once": { version: "1.0.0" },
          },
        })
      );
      const result = performDependencyAudit(dir);
      expect(result.duplicatePackages).toEqual([
        "@s/pkg (2 versions in lock file: 1.0.0, 1.1.0)",
        "left-pad (2 versions in lock file: 1.0.0, 2.0.0)",
      ]);
      expect(result.reports.every((r) => r.startsWith("Duplicate package versions:"))).toBe(true);
    });

    test("npm lockfile v1 nested dependencies", () => {
      write(
        "package-lock.json",
        JSON.stringify({
          lockfileVersion: 1,
          dependencies: {
            a: { version: "1.0.0", dependencies: { ms: { version: "2.0.0" } } },
            ms: { version: "2.1.0" },
          },
        })
      );
      expect(performDependencyAudit(dir).duplicatePackages).toEqual(["ms (2 versions in lock file: 2.0.0, 2.1.0)"]);
    });

    test("malformed package-lock.json does not throw", () => {
      write("package-lock.json", "{not json");
      expect(performDependencyAudit(dir).duplicatePackages).toEqual([]);
    });

    test("same version listed twice is not a duplicate", () => {
      write(
        "package-lock.json",
        JSON.stringify({
          lockfileVersion: 3,
          packages: {
            "node_modules/a": { version: "1.0.0" },
            "node_modules/b/node_modules/a": { version: "1.0.0" },
          },
        })
      );
      expect(performDependencyAudit(dir).duplicatePackages).toEqual([]);
    });

    test("yarn.lock classic with scoped packages and merged headers", () => {
      write(
        "yarn.lock",
        [
          `# yarn lockfile v1`,
          ``,
          `"@babel/core@^7.0.0", "@babel/core@^7.1.0":`,
          `  version "7.1.0"`,
          ``,
          `"@babel/core@^6.0.0":`,
          `  version "6.0.0"`,
          ``,
          `lodash@^4.0.0, lodash@^4.17.0:`,
          `  version "4.17.21"`,
          ``,
        ].join("\n")
      );
      expect(performDependencyAudit(dir).duplicatePackages).toEqual([
        "@babel/core (2 versions in lock file: 6.0.0, 7.1.0)",
      ]);
    });

    test("yarn berry format", () => {
      write(
        "yarn.lock",
        [
          `__metadata:`,
          `  version: 6`,
          ``,
          `"ms@npm:^2.0.0":`,
          `  version: 2.0.0`,
          ``,
          `"ms@npm:^2.1.0":`,
          `  version: 2.1.3`,
          ``,
        ].join("\n")
      );
      expect(performDependencyAudit(dir).duplicatePackages).toEqual(["ms (2 versions in lock file: 2.0.0, 2.1.3)"]);
    });

    test("pnpm-lock.yaml in v6 and v9 styles", () => {
      write(
        "pnpm-lock.yaml",
        [
          `lockfileVersion: '6.0'`,
          `packages:`,
          `  /ms@2.0.0:`,
          `    resolution: {integrity: x}`,
          `  /@scope/pkg@1.0.0(peer@2.0.0):`,
          `    resolution: {integrity: y}`,
          `  '@scope/pkg@1.2.0':`,
          `    resolution: {integrity: z}`,
          `  ms@2.1.0:`,
          `    resolution: {integrity: w}`,
          `snapshots:`,
          `  other@9.9.9:`,
          `    dependencies: {}`,
        ].join("\n")
      );
      expect(performDependencyAudit(dir).duplicatePackages).toEqual([
        "@scope/pkg (2 versions in lock file: 1.0.0, 1.2.0)",
        "ms (2 versions in lock file: 2.0.0, 2.1.0)",
      ]);
    });

    test("deduplicates across multiple lock files", () => {
      write(
        "package-lock.json",
        JSON.stringify({ lockfileVersion: 3, packages: { "node_modules/ms": { version: "2.0.0" } } })
      );
      write("yarn.lock", `ms@^2.0.0:\n  version "2.0.0"\n`);
      expect(performDependencyAudit(dir).duplicatePackages).toEqual([]);
    });
  });

  describe("file skipping and deprecated patterns", () => {
    test("skips whole segments only, not substrings", () => {
      write("src/build-tools/x.ts", `fs.exists("a");\n`);
      write("src/distribution.ts", `fs.exists("b");\n`);
      write("src/build/y.ts", `fs.exists("c");\n`);
      write("src/generated/z.ts", `fs.exists("d");\n`);
      write("out/o.ts", `fs.exists("e");\n`);
      const reported = performDependencyAudit(dir).deprecatedImports.join("\n");
      expect(reported).toContain("src/build-tools/x.ts");
      expect(reported).toContain("src/distribution.ts");
      expect(reported).not.toContain("src/build/y.ts");
      expect(reported).not.toContain("src/generated/z.ts");
      expect(reported).not.toContain("out/o.ts");
    });

    test("ignores deprecated names in comments and strings", () => {
      write(
        "src/c.ts",
        [`// use querystring and url.parse here`, `/* new Buffer(1) */`, `const s = "fs.exists(x) __dirname";`].join("\n")
      );
      expect(performDependencyAudit(dir).deprecatedImports).toEqual([]);
    });

    test("reports new Buffer() once and bare Buffer() separately", () => {
      write("src/n.ts", `const a = new Buffer(4);\nconst b = Buffer.from("x");\n`);
      write("src/f.ts", `const a = Buffer(4);\n`);
      const reported = performDependencyAudit(dir).deprecatedImports;
      expect(reported.filter((r) => r.includes("src/n.ts"))).toHaveLength(1);
      expect(reported.filter((r) => r.includes("src/f.ts"))).toHaveLength(1);
    });

    test("flags querystring only when imported or used", () => {
      write("src/q1.ts", `import qs from "querystring";\nexport default qs;\n`);
      write("src/q2.ts", `const querystring = 1;\nexport default querystring;\n`);
      const reported = performDependencyAudit(dir).deprecatedImports.join("\n");
      expect(reported).toContain("src/q1.ts");
      expect(reported).not.toContain("src/q2.ts");
    });

    test("does not self-flag when the guard file is present", () => {
      write("src/core/dependency-guard.ts", `const d = __dirname;\n`);
      expect(performDependencyAudit(dir).isClean).toBe(true);
    });
  });

  describe("DependencyGuard issue mapping", () => {
    test("emits stable codes, severities and file locations", async () => {
      write("src/a.ts", `import { b } from "./b.js";\nexport const a = b;\nconst u = url.parse("x");\n`);
      write("src/b.ts", `import { a } from "./a.js";\nexport const b = a;\n`);
      write("package.json", "{}");
      write(
        "package-lock.json",
        JSON.stringify({
          lockfileVersion: 3,
          packages: { "node_modules/ms": { version: "1.0.0" }, "node_modules/x/node_modules/ms": { version: "2.0.0" } },
        })
      );
      const result = await new DependencyGuard({ targetPath: dir }).execute();
      const byCode = new Map(result.issues.map((i) => [i.code, i]));
      expect([...byCode.keys()].sort()).toEqual([
        "DEPENDENCY_CIRCULAR",
        "DEPENDENCY_DEPRECATED_API",
        "DEPENDENCY_DUPLICATE_PACKAGE",
      ]);
      expect(byCode.get("DEPENDENCY_CIRCULAR")?.severity).toBe("error");
      expect(byCode.get("DEPENDENCY_CIRCULAR")?.location?.file).toBe("src/a.ts");
      expect(byCode.get("DEPENDENCY_DEPRECATED_API")?.severity).toBe("warning");
      expect(byCode.get("DEPENDENCY_DEPRECATED_API")?.location?.file).toBe("src/a.ts");
      expect(byCode.get("DEPENDENCY_DUPLICATE_PACKAGE")?.location?.file).toBe("package-lock.json");
    });
  });
});
