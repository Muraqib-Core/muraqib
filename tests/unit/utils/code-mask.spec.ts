import { describe, it, expect } from "vitest";
import { maskLiteralsAndComments } from "../../../src/utils/code-mask.js";

describe("maskLiteralsAndComments", () => {
  it("preserves length and line breaks", () => {
    const src = "const a = 'x';\n// note\n/* b\nc */ const d = `e\nf`;\n";
    const out = maskLiteralsAndComments(src);
    expect(out).toHaveLength(src.length);
    expect(out.split("\n")).toHaveLength(src.split("\n").length);
  });

  it("blanks single and double quoted strings but keeps the quotes", () => {
    expect(maskLiteralsAndComments(`f('a.then(b)', "c.then(d)")`)).toBe(`f('${" ".repeat(9)}', "${" ".repeat(9)}")`);
  });

  it("handles escapes inside strings", () => {
    const out = maskLiteralsAndComments(String.raw`x = 'it\'s .then(' + y`);
    expect(out).not.toContain(".then(");
    expect(out.endsWith("+ y")).toBe(true);
  });

  it("blanks line and block comments", () => {
    const out = maskLiteralsAndComments("a(); // fetch(x)\n/* new Promise( */ b();");
    expect(out).not.toContain("fetch");
    expect(out).not.toContain("Promise");
    expect(out).toContain("a();");
    expect(out).toContain("b();");
  });

  it("blanks template text across lines", () => {
    const out = maskLiteralsAndComments("const s = `\nnavigator.clipboard.writeText(t).then(done);\n`;\nreal();");
    expect(out).not.toContain(".then(");
    expect(out).toContain("real();");
  });

  it("keeps ${} expressions as code, including nested braces and templates", () => {
    const out = maskLiteralsAndComments("`text ${ fn({ a: 1 }) } more ${ `in ${deep()}` } end`; after();");
    expect(out).toContain("fn({ a: 1 })");
    expect(out).toContain("deep()");
    expect(out).not.toContain("text");
    expect(out).not.toContain("more");
    expect(out).toContain("after();");
  });

  it("recovers at a line break from an unterminated quote (regex literal)", () => {
    const out = maskLiteralsAndComments("const r = /'/;\nrealCall();");
    expect(out).toContain("realCall();");
  });

  it("handles escaped backticks and line continuations in templates", () => {
    const out = maskLiteralsAndComments("`a \\` .then( \\\nb`; z();");
    expect(out).not.toContain(".then(");
    expect(out).toContain("z();");
  });
});
