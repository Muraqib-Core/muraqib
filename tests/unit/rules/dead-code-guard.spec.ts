import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DeadCodeGuard, findUnreachableLines, performDeadCodeAudit } from "../../../src/rules/dead-code-guard.js";

let dir = "";

function write(rel: string, content: string): void {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "dead-code-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("findUnreachableLines", () => {
  it("flags a statement right after a complete jump", () => {
    expect(findUnreachableLines(["function f() {", "  return 1;", "  doIt();", "}"])).toEqual([3]);
  });

  it("treats closing braces, case, default, else and hoisted functions as reachable", () => {
    expect(findUnreachableLines(["{", "  return 1;", "}"])).toEqual([]);
    expect(findUnreachableLines(["switch (x) {", "  case 1:", "    break;", "  case 2:", "    break;", "  default:", "    break;", "}"])).toEqual([]);
    expect(findUnreachableLines(["if (a) {", "  return;", "} else {", "  go();", "}"])).toEqual([]);
    expect(findUnreachableLines(["{", "  return 1;", "  function later() {}", "}"])).toEqual([]);
    expect(findUnreachableLines(["{", "  return 1;", "  async function later() {}", "}"])).toEqual([]);
  });

  it("ignores braceless guarded jumps", () => {
    expect(findUnreachableLines(["if (a)", "  return 1;", "go();"])).toEqual([]);
    expect(findUnreachableLines(["if (a) x();", "else", "  return 1;", "go();"])).toEqual([]);
    expect(findUnreachableLines(["const f = () =>", "  return 1;", "go();"])).toEqual([]);
    expect(findUnreachableLines(["if (a)", "  // why", "", "  return 1;", "go();"])).toEqual([]);
  });

  it("follows multi-line jump statements and skips comments before the next line", () => {
    expect(findUnreachableLines(["{", "  return foo(", "    1,", "  );", "  // note", "  /* block", "   * more", "   */", "  dead();", "}"])).toEqual([9]);
  });

  it("handles bare jumps without semicolon, strings with brackets, and unterminated statements", () => {
    expect(findUnreachableLines(["{", "  break", "  dead();", "}"])).toEqual([3]);
    expect(findUnreachableLines(["{", '  return "(" + `)` + \'[\'; // ]', "  dead();", "}"])).toEqual([3]);
    expect(findUnreachableLines(["return foo(", "  1"])).toEqual([]);
    expect(findUnreachableLines(["return )"])).toEqual([]);
  });

  it("returns nothing when the jump is the last line", () => {
    expect(findUnreachableLines(["{", "  return 1;"])).toEqual([]);
  });
});

describe("performDeadCodeAudit", () => {
  it("reports empty functions, unreachable code and unused exports", () => {
    write(
      "src/util.ts",
      [
        "export function unusedA() { return 1; }",
        "export const unusedB = 2;",
        "export async function empty() {}",
        "export const noop = async () => {}",
        "export function after() {",
        "  return 1;",
        "  console.log('x');",
        "}",
      ].join("\n")
    );
    const result = performDeadCodeAudit(dir);
    expect(result.isClean).toBe(false);
    expect(result.emptyFunctions.some((e) => e.includes("(empty)"))).toBe(true);
    expect(result.emptyFunctions.some((e) => e.includes("(noop)"))).toBe(true);
    expect(result.unreachableBranches).toEqual(["src/util.ts:7"]);
    expect(result.unusedExports[0]).toContain("unusedA");
    expect(result.reports.some((r) => r.startsWith("Potentially unused exports:"))).toBe(true);
  });

  it("uses singular wording for a single unused export", () => {
    write("src/one.ts", "export const lonely = 1;\n");
    const result = performDeadCodeAudit(dir);
    expect(result.reports[0]).toContain("Potentially unused export:");
  });

  it("counts other files, tests and self-used types as consumers", () => {
    write("src/a.ts", "export const used = 1;\nexport interface Shape { a: 1 }\nexport type Alias = Shape;\nexport class Lone {}\nexport const $dollar = 1;\n");
    write("src/b.ts", 'import { used } from "./a.js";\nconsole.log(used);\n');
    write("tests/a.spec.ts", "import { Lone } from '../src/a.js'; Lone;\n");
    const result = performDeadCodeAudit(dir);
    expect(result.unusedExports).toEqual(["src/a.ts:3 (Alias, $dollar)"]);
  });

  it("skips default-named exports, index barrels, src/core and package entrypoints", () => {
    write("src/index.ts", 'export * from "./pub.js";\nexport * from "./sub/index.js";\nexport const barrel = 1;\n');
    write("src/pub.ts", "export const publicApi = 1;\n");
    write("src/sub/index.ts", "export const subApi = 1;\n");
    write("src/core/types.ts", "export const coreThing = 1;\n");
    write("src/entry.ts", 'export * from "./deep.js";\nexport const entryApi = 1;\n');
    write("src/deep.ts", "export const deepApi = 1;\n");
    write(
      "package.json",
      JSON.stringify({ main: "./dist/entry.js", types: "dist/entry.d.ts", exports: { ".": { import: ["./dist/entry.js"] } }, other: 1 })
    );
    expect(performDeadCodeAudit(dir).unusedExports).toEqual([]);
  });

  it("falls back to heuristics when package.json is missing, invalid or not an object", () => {
    write("src/x.ts", "export const lonelyX = 1;\n");
    expect(performDeadCodeAudit(dir).unusedExports).toHaveLength(1);
    write("package.json", "{not json");
    expect(performDeadCodeAudit(dir).unusedExports).toHaveLength(1);
    write("package.json", "null");
    expect(performDeadCodeAudit(dir).unusedExports).toHaveLength(1);
    write("package.json", JSON.stringify({ main: "plain.txt", exports: 5 }));
    expect(performDeadCodeAudit(dir).unusedExports).toHaveLength(1);
  });

  it("honours whole-file and per-line suppression markers", () => {
    write("src/skip.ts", "// muraqib-ignore-dead\nexport const ignored = 1;\nfunction e() {}\n");
    write(
      "src/line.ts",
      [
        "export const sup = 1; // muraqib-ignore-dead",
        "function e2() {} // muraqib-ignore-dead",
        "function f() {",
        "  return 1;",
        "  dead(); // muraqib-unreachable",
        "}",
      ].join("\n")
    );
    expect(performDeadCodeAudit(dir)).toMatchObject({ isClean: true, reports: [] });
  });

  it("is clean for an empty project and ignores .d.ts files", () => {
    write("src/types.d.ts", "export declare const t: number;\n");
    expect(performDeadCodeAudit(dir).isClean).toBe(true);
  });
});

describe("DeadCodeGuard", () => {
  it("returns ok for clean code", async () => {
    write("src/a.ts", "export const a = 1;\n");
    write("src/b.ts", "import { a } from './a.js'; a;\n");
    const result = await new DeadCodeGuard(dir).execute();
    expect(result.status).toBe("ok");
    expect(result.issues).toHaveLength(0);
  });

  it("maps findings to issues with the right codes and severities", async () => {
    write("src/a.ts", "export const lonely = 1;\nfunction e() {}\nfunction g() {\n  return 1;\n  dead();\n}\n");
    const result = await new DeadCodeGuard(dir).execute();
    expect(result.status).toBe("warning");
    const byCode = Object.fromEntries(result.issues.map((i) => [i.code, i.severity]));
    expect(byCode).toEqual({ EMPTY_FUNCTION: "warning", UNREACHABLE_CODE: "warning", UNUSED_EXPORT: "info" });
  });
});
