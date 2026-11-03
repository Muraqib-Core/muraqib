import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

  test("contextLines limits the context around a change; the default stays git's", () => {
    const { orig, mod } = mk();
    const lines = Array.from({ length: 11 }, (_, i) => `l${i}`);
    put(orig, "src/c.ts", `${lines.join("\n")}\n`);
    put(mod, "src/c.ts", `${lines.map((l, i) => (i === 5 ? "changed" : l)).join("\n")}\n`);
    const narrow = makePatch(orig, mod, ["src/c.ts"], 1);
    expect(narrow).toContain(" l4");
    expect(narrow).not.toContain("\n l3\n");
    expect(makePatch(orig, mod, ["src/c.ts"])).toContain("\n l3\n");
  });
});

describe("makePatch when git is configured like Git for Windows (core.autocrlf=true)", () => {
  const ENV = ["GIT_CONFIG_COUNT", "GIT_CONFIG_KEY_0", "GIT_CONFIG_VALUE_0"] as const;

  test("keeps the CR of CRLF lines, so the patch applies to the real CRLF file", () => {
    const orig = tmp("agent-v2-crlf-orig-");
    const mod = tmp("agent-v2-crlf-mod-");
    roots.push(orig, mod);
    for (const root of [orig, mod]) mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(orig, "src/f.ts"), "line1\r\nline2\r\nline3\r\n");
    writeFileSync(join(mod, "src/f.ts"), "line1\r\nXline2\r\nline3\r\n");

    const saved = ENV.map((name) => process.env[name]);
    process.env["GIT_CONFIG_COUNT"] = "1";
    process.env["GIT_CONFIG_KEY_0"] = "core.autocrlf";
    process.env["GIT_CONFIG_VALUE_0"] = "true";
    let patch: string;
    try {
      patch = makePatch(orig, mod, ["src/f.ts"]);
    } finally {
      ENV.forEach((name, i) => {
        const value = saved[i];
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      });
    }

    expect(patch).toContain("-line2\r\n");
    expect(patch).toContain("+Xline2\r\n");
    const target = copyProject(orig);
    roots.push(target);
    const patchFile = join(tmp("agent-v2-crlf-patch-"), "x.patch");
    roots.push(join(patchFile, ".."));
    writeFileSync(patchFile, patch);
    git(target, ["apply", "--check", patchFile]);
    git(target, ["apply", patchFile]);
    expect(readFileSync(join(target, "src/f.ts"), "utf-8")).toBe("line1\r\nXline2\r\nline3\r\n");
  });
});
