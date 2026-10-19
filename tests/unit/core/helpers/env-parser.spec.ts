import { describe, it, expect } from "vitest";
import { parseEnvEntries } from "../../../../src/core/helpers/env-parser.js";

describe("parseEnvEntries", () => {
  it("parses simple KEY=value pairs, export prefixes and CRLF line endings", () => {
    expect(parseEnvEntries("A=1\r\nexport B = two\nC=\n")).toEqual([
      { key: "A", value: "1" },
      { key: "B", value: "two" },
      { key: "C", value: "" },
    ]);
  });

  it("skips blank lines, comments and malformed lines", () => {
    expect(parseEnvEntries("# c\n\n  \n1BAD=x\nnot a pair\nOK=1")).toEqual([{ key: "OK", value: "1" }]);
  });

  it("strips trailing inline comments from unquoted values only", () => {
    expect(parseEnvEntries('A=value # note\nB="va # lue"\nC=a#b')).toEqual([
      { key: "A", value: "value" },
      { key: "B", value: "va # lue" },
      { key: "C", value: "a#b" },
    ]);
  });

  it("supports single, double and backtick quotes and escaped quotes", () => {
    expect(parseEnvEntries("A='x y'\nB=\"he said \\\"hi\\\"\"\nC=`t`")).toEqual([
      { key: "A", value: "x y" },
      { key: "B", value: 'he said \\"hi\\"' },
      { key: "C", value: "t" },
    ]);
  });

  it("does not treat a backslash as an escape inside single quotes", () => {
    expect(parseEnvEntries("A='a\\'\nB=2")).toEqual([
      { key: "A", value: "a\\" },
      { key: "B", value: "2" },
    ]);
  });

  it("joins multi-line quoted values", () => {
    expect(parseEnvEntries('KEY="line1\nline2"\nNEXT=1')).toEqual([
      { key: "KEY", value: "line1\nline2" },
      { key: "NEXT", value: "1" },
    ]);
  });

  it("keeps the first line and resumes on the next line when a quote is never closed", () => {
    expect(parseEnvEntries('A="open\nB=2')).toEqual([
      { key: "A", value: "open" },
      { key: "B", value: "2" },
    ]);
  });
});
