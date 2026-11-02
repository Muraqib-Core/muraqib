import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { makePatch } from "../../../../src/agent-v2/fix/patch.js";
import { applyEdits, copyProject } from "../../../../src/agent-v2/fix/project-copy.js";
import { BAD_SRC, GOOD_SRC, badProject, put, tmp } from "./helpers.js";

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});
function mk(): { orig: string; mod: string } {
  const orig = badProject();
  const mod = copyProject(orig);
  roots.push(orig, mod);
  return { orig, mod };
}
function git(cwd: string, args: string[]): string {
  // core.autocrlf=false: Windows runners default to true, which would rewrite the applied file with CRLF.
  return execFileSync("git", ["-c", "core.autocrlf=false", ...args], { cwd, encoding: "utf-8" });
}

describe("makePatch", () => {
  test("produces a git patch that applies to a copy of the original", () => {
    const { orig, mod } = mk();
    applyEdits(mod, [{ file: "src/a.ts", content: GOOD_SRC }]);
    const patch = makePatch(orig, mod, ["src/a.ts"]);
    expect(patch).toContain("+  await f();");
    expect(patch).toMatch(/^diff --git a\/src\/a\.ts b\/src\/a\.ts$/m);
    expect(patch).toContain("+  await f();");
    const target = copyProject(orig);
    roots.push(target);
    const patchFile = join(tmp("agent-v2-patchfile-"), "x.patch");
    roots.push(join(patchFile, ".."));
    writeFileSync(patchFile, patch);
    git(target, ["apply", "--check", patchFile]);
    git(target, ["apply", patchFile]);
    expect(readFileSync(join(target, "src/a.ts"), "utf-8")).toBe(GOOD_SRC);
  });

  test("creates new files", () => {
    const { orig, mod } = mk();
    applyEdits(mod, [{ file: "src/deep/new.ts", content: "export const x = 1;\n" }]);
    const patch = makePatch(orig, mod, ["src/deep/new.ts"]);
    expect(patch).toContain("new file mode");
    const target = copyProject(orig);
    roots.push(target);
    const patchFile = join(target, "..", `p-${Date.now()}.patch`);
    writeFileSync(patchFile, patch);
    try {
      git(target, ["apply", "--check", patchFile]);
      git(target, ["apply", patchFile]);
    } finally {
      rmSync(patchFile, { force: true });
    }
    expect(readFileSync(join(target, "src/deep/new.ts"), "utf-8")).toBe("export const x = 1;\n");
  });

  test("returns an empty string when nothing changed", () => {
    const { orig, mod } = mk();
    expect(makePatch(orig, mod, ["src/a.ts"])).toBe("");
    expect(makePatch(orig, mod, [])).toBe("");
    expect(makePatch(orig, mod, ["src/missing.ts"])).toBe("");
  });

  test("only includes the listed files", () => {
    const { orig, mod } = mk();
    put(orig, "src/b.ts", BAD_SRC);
    put(mod, "src/b.ts", BAD_SRC);
    applyEdits(mod, [{ file: "src/a.ts", content: GOOD_SRC }, { file: "src/b.ts", content: GOOD_SRC }]);
    const patch = makePatch(orig, mod, ["src/a.ts"]);
    expect(patch).toContain("src/a.ts");
    expect(patch).not.toContain("src/b.ts");
  });
});
