import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { scanProjectFiles } from "../../../src/utils/file-scanner.js";

describe("scanProjectFiles", () => {
  let root: string;

  const write = (relative: string, content = "export const x = 1;"): void => {
    const full = path.join(root, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  };
  const names = (files: Array<{ relativePath: string }>): string[] =>
    files.map((f) => f.relativePath.replace(/\\/g, "/")).sort();

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "file-scanner-"));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("skips node_modules, dist and coverage at any depth", () => {
    write("src/a.ts");
    write("node_modules/dep/b.ts");
    write("packages/web/node_modules/dep/c.ts");
    write("packages/web/dist/d.ts");
    write("coverage/e.ts");

    expect(names(scanProjectFiles(root, ["ts"]))).toEqual(["src/a.ts"]);
  });

  it("leaves out tests and declaration files unless includeTests is set", () => {
    write("src/a.ts");
    write("src/a.spec.ts");
    write("tests/b.ts");
    write("src/types.d.ts");

    expect(names(scanProjectFiles(root, ["ts"]))).toEqual(["src/a.ts"]);
    expect(names(scanProjectFiles(root, ["ts"], { includeTests: true }))).toEqual(["src/a.spec.ts", "src/a.ts", "tests/b.ts"]);
  });

  it("skips an unreadable file instead of throwing", () => {
    write("src/ok.ts");
    fs.symlinkSync(path.join(root, "missing-target.ts"), path.join(root, "src/broken.ts"));

    expect(names(scanProjectFiles(root, ["ts"]))).toEqual(["src/ok.ts"]);
  });
});
