import { afterEach, beforeEach, describe, expect, test } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DependencyGuard, performDependencyAudit } from "../../../src/core/dependency-guard.js";

describe("dependency guard", () => {
  let dir = "";

  const write = (rel: string, content: string): void => {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "muraqib-depguard-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  describe("performDependencyAudit", () => {
    test("is clean for a project with no problems", () => {
      write("src/a.ts", `import { b } from "./b";\nexport const a = b;\n`);
      write("src/b.ts", `export const b = 1;\n`);
      write("package.json", JSON.stringify({ dependencies: { x: "^1.0.0" } }));
      const result = performDependencyAudit(dir);
      expect(result.isClean).toBe(true);
      expect(result.reports).toEqual([]);
    });

    test("detects circular imports", () => {
      write("src/a.ts", `import { b } from "./b";\nexport const a = b;\n`);
      write("src/b.ts", `import { a } from "./a";\nexport const b = a;\n`);
      const result = performDependencyAudit(dir);
      expect(result.circularDependencies.length).toBeGreaterThan(0);
      expect(result.reports.some((r) => r.startsWith("Circular dependency detected"))).toBe(true);
    });

    test("resolves explicit index imports when detecting cycles", () => {
      write("src/a.ts", `import { b } from "./lib/index";\nexport const a = b;\n`);
      write("src/lib/index.ts", `import { a } from "../a";\nexport const b = a;\n`);
      expect(performDependencyAudit(dir).circularDependencies.length).toBeGreaterThan(0);
    });

    test("ignores bare package imports and unresolved relative imports", () => {
      write("src/a.ts", `import fs from "fs";\nimport { z } from "./missing";\nexport const a = 1;\n`);
      expect(performDependencyAudit(dir).circularDependencies).toEqual([]);
    });

    test("flags deprecated API usage", () => {
      write(
        "src/old.ts",
        [
          `const u = url.parse("x");`,
          `const b = new Buffer(4);`,
          `fs.exists("a");`,
          `const d = __dirname;`,
          `const r = require("x");`,
        ].join("\n")
      );
      const result = performDependencyAudit(dir);
      expect(result.deprecatedImports.length).toBeGreaterThanOrEqual(4);
      expect(result.reports.join("\n")).toContain("Use new URL() constructor instead");
    });

    test("allows require() in scripts, config and tests folders", () => {
      write("scripts/build.js", `const x = require("x");\n`);
      const result = performDependencyAudit(dir);
      expect(result.deprecatedImports.some((d) => d.includes("require"))).toBe(false);
    });

    test("skips generated and declaration files", () => {
      write("src/types.d.ts", `declare const b = new Buffer(1);\n`);
      write("generated/x.ts", `fs.exists("a");\n`);
      expect(performDependencyAudit(dir).isClean).toBe(true);
    });

    test("flags v0.x dependencies", () => {
      write("package.json", JSON.stringify({ dependencies: { old: "^0.5.0" }, devDependencies: { ok: "^1.0.0" } }));
      const result = performDependencyAudit(dir);
      expect(result.outdatedPackages).toEqual(["old@^0.5.0 — v0.x may have breaking changes"]);
    });

    test("flags duplicate versions in a lock file", () => {
      write("package.json", JSON.stringify({}));
      write("yarn.lock", `"left-pad@1.0.0":\n  x\n"left-pad@2.0.0":\n  y\n"once@1.0.0":\n  z\n`);
      const result = performDependencyAudit(dir);
      expect(result.duplicatePackages).toEqual(["left-pad (2 versions in lock file)"]);
    });
  });

  describe("DependencyGuard", () => {
    test("returns ok when nothing is wrong", async () => {
      write("src/a.ts", `export const a = 1;\n`);
      const result = await new DependencyGuard({ targetPath: dir }).execute();
      expect(result.status).toBe("ok");
      expect(result.issues).toEqual([]);
    });

    test("maps circular dependencies to errors and others to warnings", async () => {
      write("src/a.ts", `import { b } from "./b";\nexport const a = b;\nconst u = url.parse("x");\n`);
      write("src/b.ts", `import { a } from "./a";\nexport const b = a;\n`);
      write("package.json", JSON.stringify({ dependencies: { old: "^0.1.0" } }));
      const result = await new DependencyGuard({ targetPath: dir }).execute();
      expect(result.status).toBe("issues");
      const severities = new Map(result.issues.map((i) => [i.message.split(" ")[0], i.severity]));
      expect(severities.get("Circular")).toBe("error");
      expect(severities.get("Deprecated")).toBe("warning");
      expect(severities.get("Potentially")).toBe("warning");
      expect(result.issues[0]?.code.startsWith("DEPENDENCY_")).toBe(true);
    });
  });
});
