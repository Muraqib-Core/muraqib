import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SKIPPED_DIR_NAMES, SOURCE_SCAN_IGNORED_DIRS } from "./constants.js";
import { readDirEntries, readJsonFile } from "./fs-safe.js";
import { isWithinRoot, toPosix } from "./paths.js";

const dirs: string[] = [];
const tempDir = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "muraqib-shared-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("shared constants", () => {
  it("skips dependency, VCS and build output folders", () => {
    for (const name of ["node_modules", ".git", "dist", "build", "out", "coverage", ".next", ".nuxt"]) {
      expect(SKIPPED_DIR_NAMES.has(name)).toBe(true);
    }
    expect(SKIPPED_DIR_NAMES.has("src")).toBe(false);
  });

  it("keeps the glob ignore list narrower than the walker skip list", () => {
    expect(SOURCE_SCAN_IGNORED_DIRS).toEqual(["node_modules", "dist", "coverage"]);
  });
});

describe("paths", () => {
  it("normalizes separators to forward slashes", () => {
    expect(toPosix(["a", "b", "c.ts"].join(path.sep))).toBe("a/b/c.ts");
    expect(toPosix("a\\b\\c.ts")).toBe("a/b/c.ts");
  });

  it("detects whether a target stays inside the root", () => {
    const root = path.resolve("/tmp/project");
    expect(isWithinRoot(root, root)).toBe(true);
    expect(isWithinRoot(root, path.join(root, "src", "a.ts"))).toBe(true);
    expect(isWithinRoot(root, path.resolve(root, "..", "other"))).toBe(false);
    expect(isWithinRoot(root, path.resolve(root, "..", "project-sibling"))).toBe(false);
  });
});

describe("fs-safe", () => {
  it("lists entries and treats a missing directory as empty", () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, "a.txt"), "x");
    expect(readDirEntries(dir).map((e) => e.name)).toEqual(["a.txt"]);
    expect(readDirEntries(path.join(dir, "missing"))).toEqual([]);
  });

  it("parses JSON and returns undefined for missing or invalid files", () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, "ok.json"), '{"a":1}');
    fs.writeFileSync(path.join(dir, "bad.json"), "{nope");
    expect(readJsonFile(path.join(dir, "ok.json"))).toEqual({ a: 1 });
    expect(readJsonFile(path.join(dir, "bad.json"))).toBeUndefined();
    expect(readJsonFile(path.join(dir, "missing.json"))).toBeUndefined();
  });
});
