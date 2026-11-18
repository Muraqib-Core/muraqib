import { describe, expect, test } from "vitest";
import { classifyCode, commentOnlyLines, KIND_CODE, KIND_COMMENT, KIND_STRING } from "../../../src/agent-v2/detectors/code-mask.js";

function kindOf(source: string, needle: string): number | undefined {
  return classifyCode(source)[source.indexOf(needle)];
}

describe("classifyCode", () => {
  test("plain code, line comments, strings and template text are told apart", () => {
    const source = 'const a = process.env.CODE; // process.env.NOTE\nconst s = "process.env.STR";\nconst t = `x ${process.env.EXPR} process.env.TEXT`;\n';
    expect(kindOf(source, "process.env.CODE")).toBe(KIND_CODE);
    expect(kindOf(source, "process.env.NOTE")).toBe(KIND_COMMENT);
    expect(kindOf(source, "process.env.STR")).toBe(KIND_STRING);
    expect(kindOf(source, "process.env.EXPR")).toBe(KIND_CODE);
    expect(kindOf(source, "process.env.TEXT")).toBe(KIND_STRING);
  });

  test("a division is not a regex, and a regex with quotes does not swallow the next line", () => {
    const source = "const d = a / b / c; const x = process.env.AFTER_DIV;\nconst r = /[\"']/g; const y = process.env.AFTER_RE;\n";
    expect(kindOf(source, "process.env.AFTER_DIV")).toBe(KIND_CODE);
    expect(kindOf(source, "process.env.AFTER_RE")).toBe(KIND_CODE);
  });

  test("an unterminated quote only affects its own line", () => {
    const source = "const a = 'oops;\nconst b = process.env.NEXT_LINE;\n";
    expect(kindOf(source, "process.env.NEXT_LINE")).toBe(KIND_CODE);
  });

  test("a URL inside a string is not a comment", () => {
    const source = 'const u = "http://example.com"; const v = process.env.AFTER_URL;\n';
    expect(kindOf(source, "process.env.AFTER_URL")).toBe(KIND_CODE);
  });

  test("block comments span lines", () => {
    const source = "/**\n * process.env.DOC\n */\nconst z = process.env.REAL;\n";
    expect(kindOf(source, "process.env.DOC")).toBe(KIND_COMMENT);
    expect(kindOf(source, "process.env.REAL")).toBe(KIND_CODE);
  });
});

describe("commentOnlyLines", () => {
  test("lists comment-only lines and ignores trailing comments", () => {
    const source = "// one\nconst a = 1; // trailing\n/**\n * doc\n */\nconst b = 2;\n";
    expect([...commentOnlyLines(source)]).toEqual([1, 3, 4, 5]);
  });

  test("works with CRLF files", () => {
    expect([...commentOnlyLines("// one\r\nconst a = 1;\r\n// two\r\n")]).toEqual([1, 3]);
  });
});
