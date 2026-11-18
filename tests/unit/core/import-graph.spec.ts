import { describe, expect, it } from "vitest";
import path from "node:path";
import { extractImportSpecifiers, findCycles, resolveImportTarget } from "../../../src/core/helpers/import-graph.js";

describe("extractImportSpecifiers", () => {
  it("finds static, re-export, side-effect, dynamic and require specifiers once each", () => {
    const source = [
      'import a from "./a.js";',
      'import { b,\n  c } from "./b.js";',
      'export * from "./c.js";',
      'import "./side.js";',
      'const d = await import("./d.js");',
      'const e = require("./e.cjs");',
      'import again from "./a.js";',
      '// import x from "./commented.js";',
    ].join("\n");
    expect(extractImportSpecifiers(source)).toEqual(["./a.js", "./b.js", "./c.js", "./side.js", "./d.js", "./e.cjs"]);
  });

  it("drops statement-level type-only edges only when asked", () => {
    const source = 'import type { T } from "./t.js";\nexport type { U } from "./u.js";\nimport { type V } from "./v.js";\nimport type, { w } from "./w.js";';
    expect(extractImportSpecifiers(source)).toEqual(["./t.js", "./u.js", "./v.js", "./w.js"]);
    expect(extractImportSpecifiers(source, { includeTypeOnly: false })).toEqual(["./v.js", "./w.js"]);
  });

  it("ignores empty, unterminated and multi-line specifiers", () => {
    expect(extractImportSpecifiers('import x from "";')).toEqual([]);
    expect(extractImportSpecifiers('import x from "./open')).toEqual([]);
    expect(extractImportSpecifiers('import x from "./a\n./b";')).toEqual([]);
  });
});

describe("resolveImportTarget", () => {
  const from = path.resolve("/p/src/a.ts");
  const files = (...names: string[]): ((p: string) => boolean) => {
    const set = new Set(names.map((n) => path.resolve(n)));
    return (p) => set.has(p);
  };

  it("ignores bare specifiers", () => {
    expect(resolveImportTarget(from, "lodash", () => true)).toBeUndefined();
  });

  it("resolves exact files, JS-to-TS twins, appended extensions and index files", () => {
    expect(resolveImportTarget(from, "./b.json", files("/p/src/b.json"))).toBe(path.resolve("/p/src/b.json"));
    expect(resolveImportTarget(from, "./b.js", files("/p/src/b.ts"))).toBe(path.resolve("/p/src/b.ts"));
    expect(resolveImportTarget(from, "./b.mjs", files("/p/src/b.mts"))).toBe(path.resolve("/p/src/b.mts"));
    expect(resolveImportTarget(from, "./b", files("/p/src/b.tsx"))).toBe(path.resolve("/p/src/b.tsx"));
    expect(resolveImportTarget(from, "./dir", files("/p/src/dir/index.js"))).toBe(path.resolve("/p/src/dir/index.js"));
    expect(resolveImportTarget(from, "/p/src/abs", files("/p/src/abs.ts"))).toBe(path.resolve("/p/src/abs.ts"));
  });

  it("returns undefined when nothing matches", () => {
    expect(resolveImportTarget(from, "./missing.js", () => false)).toBeUndefined();
  });
});

describe("findCycles", () => {
  const graph = (edges: Record<string, string[]>): Map<string, Set<string>> =>
    new Map(Object.entries(edges).map(([k, v]) => [k, new Set(v)]));

  it("returns nothing for acyclic graphs and ignores unknown nodes", () => {
    expect(findCycles(graph({ a: ["b", "ghost"], b: [], c: ["b"] }))).toEqual([]);
  });

  it("finds a self-loop and rotates cycles to their smallest node", () => {
    expect(findCycles(graph({ a: ["a"] }))).toEqual([["a", "a"]]);
    expect(findCycles(graph({ c: ["b"], b: ["a"], a: ["c"] }))).toEqual([["a", "c", "b", "a"]]);
  });

  it("reports each distinct cycle once, including overlapping ones", () => {
    const cycles = findCycles(graph({ a: ["b", "c"], b: ["a"], c: ["a", "b"] }));
    expect(cycles).toContainEqual(["a", "b", "a"]);
    expect(cycles).toContainEqual(["a", "c", "a"]);
    expect(new Set(cycles.map((c) => c.join(">"))).size).toBe(cycles.length);
  });
});
