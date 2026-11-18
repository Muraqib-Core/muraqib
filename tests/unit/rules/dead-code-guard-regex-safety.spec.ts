import { describe, expect, it } from "vitest";
import { countOccurrences, stripStringsAndComments } from "../../../src/rules/dead-code-guard";

describe("countOccurrences", () => {
  it("counts normal identifiers as whole words", () => {
    expect(countOccurrences("Foo Foo2 xFoo Foo", "Foo")).toBe(2);
  });

  it("handles $ in identifiers", () => {
    expect(countOccurrences("$el + $el + a$el", "$el")).toBe(2);
  });

  it("treats regex metacharacters literally", () => {
    expect(countOccurrences("a.b axb a.b", "a.b")).toBe(2);
    expect(countOccurrences("foo+bar fooobar foo+bar", "foo+bar")).toBe(2);
    expect(countOccurrences("(x) [y] {z} ^|*?\\", "(x)")).toBe(1);
    expect(countOccurrences("[y]", "[y]")).toBe(1);
  });

  it("does not throw on unbalanced metacharacters", () => {
    expect(() => countOccurrences("abc", "(")).not.toThrow();
    expect(countOccurrences("abc", "[")).toBe(0);
  });
});

describe("stripStringsAndComments", () => {
  it("removes line comments", () => {
    expect(stripStringsAndComments("const a = 1; // note (")).toBe("const a = 1; ");
  });

  it("collapses all quote kinds and escapes", () => {
    expect(stripStringsAndComments(`f("a(", 'b)', \`c{\`, "q\\"x")`)).toBe('f("", "", "", "")');
  });

  it("keeps unterminated quotes as-is", () => {
    expect(stripStringsAndComments(`x = "abc`)).toBe(`x = "abc`);
    expect(stripStringsAndComments(`it's "ok"`)).toBe(`it's ""`);
  });

  it("matches legacy behavior on a corpus", () => {
    const legacy = (l: string): string =>
      l.replace(/\/\/.*$/, "").replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g, '""');
    const corpus = [
      "",
      "plain",
      `a "b" 'c' \`d\``,
      `"a\\"b" + 'c\\'d'`,
      `"unterminated \\" still`,
      `'x' "y`,
      `"a" // "b"`,
      `url = "http://x.y"`,
      `a'b"c'd"e`,
      `"\\`,
      `"""'''\`\`\``,
    ];
    for (const line of corpus) expect(stripStringsAndComments(line)).toBe(legacy(line));
  });

  it("is linear on adversarial input", () => {
    for (const input of ["//".repeat(50_000), '"'.repeat(100_000), `"\\`.repeat(50_000), `'a"`.repeat(33_000)]) {
      const start = performance.now();
      stripStringsAndComments(input);
      expect(performance.now() - start).toBeLessThan(1000);
    }
  });
});
