import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readCompilerOptions } from "./tsconfig-parser.js";

describe("readCompilerOptions", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "muraqib-tsconfig-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("parses plain JSON", () => {
    writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true } }));
    expect(readCompilerOptions(join(dir, "tsconfig.json"))).toEqual({ strict: true });
  });

  it("parses comments, trailing commas and a BOM, keeping comment-like strings", () => {
    writeFileSync(
      join(dir, "tsconfig.json"),
      '﻿{\n // line\n "compilerOptions": { /* block */ "strict": true, "paths": {"@/*": ["src//x/*"]}, },\n}\n'
    );
    const options = readCompilerOptions(join(dir, "tsconfig.json"));
    expect(options?.strict).toBe(true);
    expect(options?.paths).toEqual({ "@/*": ["src//x/*"] });
  });

  it("handles escaped quotes inside strings", () => {
    writeFileSync(join(dir, "tsconfig.json"), '{"compilerOptions": {"outDir": "a\\"b,]"}}');
    expect(readCompilerOptions(join(dir, "tsconfig.json"))?.outDir).toBe('a"b,]');
  });

  it("returns undefined when there are no compilerOptions", () => {
    writeFileSync(join(dir, "tsconfig.json"), "{}");
    expect(readCompilerOptions(join(dir, "tsconfig.json"))).toBeUndefined();
  });

  it("treats a non-object root as empty", () => {
    writeFileSync(join(dir, "tsconfig.json"), "[]");
    expect(readCompilerOptions(join(dir, "tsconfig.json"))).toBeUndefined();
  });

  it("throws on invalid JSON", () => {
    writeFileSync(join(dir, "tsconfig.json"), "{ nope");
    expect(() => readCompilerOptions(join(dir, "tsconfig.json"))).toThrow();
  });

  it("merges relative extends (with and without .json) and lets the child override", () => {
    writeFileSync(join(dir, "base.json"), JSON.stringify({ compilerOptions: { strict: true, target: "ES5" } }));
    mkdirSync(join(dir, "sub"));
    writeFileSync(join(dir, "sub", "mid.json"), JSON.stringify({ extends: "../base", compilerOptions: { noImplicitAny: true } }));
    writeFileSync(
      join(dir, "tsconfig.json"),
      JSON.stringify({ extends: ["./sub/mid.json", "./missing.json", 5], compilerOptions: { target: "ES2022" } })
    );
    expect(readCompilerOptions(join(dir, "tsconfig.json"))).toEqual({
      strict: true,
      noImplicitAny: true,
      target: "ES2022",
    });
  });

  it("supports a string extends and skips package extends and unreadable parents", () => {
    writeFileSync(join(dir, "broken.json"), "{ broken");
    writeFileSync(join(dir, "a.json"), JSON.stringify({ extends: "@tsconfig/node20/tsconfig.json", compilerOptions: { x: 1 } }));
    writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ extends: "./a.json" }));
    expect(readCompilerOptions(join(dir, "tsconfig.json"))).toEqual({ x: 1 });
    writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ extends: "./broken.json" }));
    expect(readCompilerOptions(join(dir, "tsconfig.json"))).toBeUndefined();
  });

  it("stops following extends cycles at the depth limit", () => {
    writeFileSync(join(dir, "a.json"), JSON.stringify({ extends: "./b.json", compilerOptions: { a: 1 } }));
    writeFileSync(join(dir, "b.json"), JSON.stringify({ extends: "./a.json", compilerOptions: { b: 1 } }));
    expect(readCompilerOptions(join(dir, "a.json"))).toMatchObject({ a: 1, b: 1 });
  });
});
