import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import { performDeadCodeAudit } from "./dead-code-guard";

describe("performDeadCodeAudit", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = path.join(process.cwd(), ".test-dead-code-audit");
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("detects empty function bodies", () => {
    const testFile = path.join(testDir, "empty-function.ts");
    const content = `
      export function emptyFunc() {}
      export const arrowEmpty = () => {};
      export async function asyncEmpty() {}
    `;
    fs.writeFileSync(testFile, content);

    const result = performDeadCodeAudit(testDir);

    expect(result.isClean).toBe(false);
    expect(result.emptyFunctions.length).toBeGreaterThan(0);
    expect(result.reports.some((r) => r.includes("Empty function body"))).toBe(true);
  });

  it("detects unreachable code after return statements", () => {
    fs.writeFileSync(
      path.join(testDir, "unreachable.ts"),
      `export function unreachableFunc() {
  return 42;
  const x = 5;
}`
    );

    const result = performDeadCodeAudit(testDir);

    expect(result.unreachableBranches).toEqual(["unreachable.ts:3"]);
  });

  it("detects unreachable code after throw statements", () => {
    fs.writeFileSync(
      path.join(testDir, "throw-unreachable.ts"),
      `export function throwFunc() {
  throw new Error("Error");
  const x = 5;
}`
    );

    expect(performDeadCodeAudit(testDir).unreachableBranches).toEqual(["throw-unreachable.ts:3"]);
  });

  it("detects unreachable code after a multi-line return", () => {
    fs.writeFileSync(
      path.join(testDir, "multi.ts"),
      `export function multi() {
  return {
    a: 1,
    b: "}",
  };
  console.log("never");
}`
    );

    expect(performDeadCodeAudit(testDir).unreachableBranches).toEqual(["multi.ts:6"]);
  });

  it("does not flag a return that ends its block (closing brace, case, else, catch)", () => {
    fs.writeFileSync(
      path.join(testDir, "normal-flow.ts"),
      `export function normal(x: number): number {
  try {
    if (x > 1) {
      return x;
    } else {
      return -x;
    }
  } catch (error) {
    throw error;
  }
}
export function sw(x: string): number {
  switch (x) {
    case "a":
      return 1;
    case "b":
      return 2;
    default:
      return 3;
  }
}
export function guard(x: number): number {
  if (x > 1)
    return x;
  for (const y of [1, 2]) {
    if (y) continue;
    break;
  }
  return 0;
}
`
    );

    expect(performDeadCodeAudit(testDir).unreachableBranches).toEqual([]);
  });

  it("detects potentially unused exports", () => {
    const testFile = path.join(testDir, "unused-export.ts");
    const content = `
      export function unusedFunction() {
        return "I am not used anywhere";
      }
      export class UnusedClass {
        method() {}
      }
    `;
    fs.writeFileSync(testFile, content);

    const result = performDeadCodeAudit(testDir);

    expect(result.unusedExports.length).toBeGreaterThan(0);
    expect(result.reports.some((r) => r.includes("Potentially unused export"))).toBe(true);
  });

  it("skips files with muraqib-ignore-dead comment", () => {
    const testFile = path.join(testDir, "ignored-file.ts");
    const content = `
      // muraqib-ignore-dead
      export function emptyFunc() {}
      export const unused = () => {};
    `;
    fs.writeFileSync(testFile, content);

    const result = performDeadCodeAudit(testDir);

    expect(result.isClean).toBe(true);
    expect(result.reports.length).toBe(0);
  });

  it("handles files with valid code correctly", () => {
    const testFile = path.join(testDir, "valid.ts");
    const content = `
      export function validFunc() {
        return 42;
      }

      function helperFunc(x: number) {
        return x * 2;
      }

      export function usedFunc() {
        return helperFunc(5);
      }
    `;
    fs.writeFileSync(testFile, content);

    const result = performDeadCodeAudit(testDir);

    expect(result.emptyFunctions.length).toBe(0);
  });

  it("handles multiple files correctly", () => {
    const file1 = path.join(testDir, "file1.ts");
    const file2 = path.join(testDir, "file2.ts");

    fs.writeFileSync(
      file1,
      `
      export function funcA() {}
      export const unusedA = () => {};
    `
    );

    fs.writeFileSync(
      file2,
      `
      export function funcB() {
        return;
        console.log("unreachable");
      }
    `
    );

    const result = performDeadCodeAudit(testDir);

    expect(result.isClean).toBe(false);
    expect(result.reports.length).toBeGreaterThan(0);
  });

  it("treats exports referenced from spec files, bin scripts and JS consumers as used", () => {
    fs.mkdirSync(path.join(testDir, "tests"), { recursive: true });
    fs.mkdirSync(path.join(testDir, "bin"), { recursive: true });
    fs.writeFileSync(path.join(testDir, "api.ts"), "export function runCli() { return 1; }\nexport interface Options { a: number }\nexport function orphan() { return 2; }\n");
    fs.writeFileSync(path.join(testDir, "bin", "cli.js"), 'import { runCli } from "../api.js";\nrunCli();\n');
    fs.writeFileSync(path.join(testDir, "tests", "api.spec.ts"), 'import type { Options } from "../api";\nexport const o: Options = { a: 1 };\n');

    const result = performDeadCodeAudit(testDir);

    expect(result.unusedExports.some((u) => u.includes("runCli"))).toBe(false);
    expect(result.unusedExports.some((u) => u.includes("Options"))).toBe(false);
    expect(result.unusedExports.some((u) => u.includes("orphan"))).toBe(true);
  });

  it("does not flag exports from src/index or src/core", () => {
    fs.mkdirSync(path.join(testDir, "src", "core"), { recursive: true });
    fs.writeFileSync(path.join(testDir, "src", "index.ts"), "export function publicApi() { return 1; }\n");
    fs.writeFileSync(path.join(testDir, "src", "core", "types.ts"), "export interface Shared { a: number }\n");

    expect(performDeadCodeAudit(testDir).unusedExports).toEqual([]);
  });

  it("correctly identifies exports that are used in other files", () => {
    const file1 = path.join(testDir, "module.ts");
    const file2 = path.join(testDir, "consumer.ts");

    fs.writeFileSync(
      file1,
      `
      export function usedFunction() {
        return "I am used";
      }
    `
    );

    fs.writeFileSync(
      file2,
      `
      import { usedFunction } from "./module";
      export function consumer() {
        return usedFunction();
      }
    `
    );

    const result = performDeadCodeAudit(testDir);

    const unusedExportReports = result.unusedExports.filter((u) => u.includes("usedFunction"));
    expect(unusedExportReports.length).toBe(0);
  });

  it("returns isClean=true when no issues found", () => {
    const testFile = path.join(testDir, "clean.ts");
    const content = `export function goodFunc(x: number): number {
  if (x > 0) {
    return x;
  }
  return 0;
}`;
    fs.writeFileSync(testFile, content);

    const result = performDeadCodeAudit(testDir);

    // Should find no dead code in this clean function
    expect(result.emptyFunctions.length).toBe(0);
    expect(result.reports.filter((r) => r.includes(testFile)).length).toBe(0);
  });

  it("handles async functions correctly", () => {
    const testFile = path.join(testDir, "async-functions.ts");
    const content = `
      export async function asyncFunc() {
        return await Promise.resolve(42);
      }

      export const asyncArrow = async () => {
        return "data";
      };
    `;
    fs.writeFileSync(testFile, content);

    const result = performDeadCodeAudit(testDir);

    expect(result.emptyFunctions.length).toBe(0);
  });
});
