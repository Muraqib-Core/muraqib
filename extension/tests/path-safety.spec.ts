import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { resolveOpenRequest } from "../src/core/open-request.js";
import { resolveExistingFileInside, resolveInsideRoot, type PathIo } from "../src/core/path-safety.js";

describe("resolveInsideRoot (posix)", () => {
  const root = "/work/project";

  it("resolves relative and absolute paths inside the root", () => {
    expect(resolveInsideRoot(root, "src/a.ts", path.posix)).toBe("/work/project/src/a.ts");
    expect(resolveInsideRoot(root, "./src/../src/a.ts", path.posix)).toBe("/work/project/src/a.ts");
    expect(resolveInsideRoot(root, "/work/project/lib/b.ts", path.posix)).toBe("/work/project/lib/b.ts");
  });

  it.each([
    "../secret.txt",
    "src/../../secret.txt",
    "../../../../etc/passwd",
    "/etc/passwd",
    "/work/project-evil/a.ts",
    "/work",
    ".",
    "",
    "src/\0evil",
    "..",
  ])("rejects %j", (candidate) => {
    expect(resolveInsideRoot(root, candidate, path.posix)).toBeUndefined();
  });

  it("rejects an empty root", () => {
    expect(resolveInsideRoot("", "a.ts", path.posix)).toBeUndefined();
  });
});

describe("resolveInsideRoot (win32)", () => {
  const root = "C:\\work\\project";

  it("accepts inside paths and rejects traversal and other drives", () => {
    expect(resolveInsideRoot(root, "src\\a.ts", path.win32)).toBe("C:\\work\\project\\src\\a.ts");
    expect(resolveInsideRoot(root, "..\\secret.txt", path.win32)).toBeUndefined();
    expect(resolveInsideRoot(root, "D:\\other\\a.ts", path.win32)).toBeUndefined();
    expect(resolveInsideRoot(root, "..\\project-evil\\a.ts", path.win32)).toBeUndefined();
  });
});

describe("resolveExistingFileInside with injected io", () => {
  const links = new Map<string, string>([["/work/project/link-out", "/outside/secret.txt"]]);
  const files = new Set(["/work/project/src/a.ts", "/outside/secret.txt"]);
  const io: PathIo = {
    realpath: async (p) => {
      const real = links.get(p) ?? p;
      if (!files.has(real) && !real.endsWith("/work/project")) throw new Error("ENOENT");
      return real;
    },
    isFile: async (p) => files.has(p),
  };

  it("returns the real path for an existing file", async () => {
    await expect(resolveExistingFileInside("/work/project", "src/a.ts", io, path.posix)).resolves.toBe("/work/project/src/a.ts");
  });

  it("rejects symlinks that leave the workspace", async () => {
    await expect(resolveExistingFileInside("/work/project", "link-out", io, path.posix)).resolves.toBeUndefined();
  });

  it("rejects missing files, traversal and non-files", async () => {
    await expect(resolveExistingFileInside("/work/project", "missing.ts", io, path.posix)).resolves.toBeUndefined();
    await expect(resolveExistingFileInside("/work/project", "../x", io, path.posix)).resolves.toBeUndefined();
    const dirIo: PathIo = { realpath: async (p) => p, isFile: async () => false };
    await expect(resolveExistingFileInside("/work/project", "src", dirIo, path.posix)).resolves.toBeUndefined();
  });
});

describe("resolveExistingFileInside on a real filesystem", () => {
  const base = mkdtempSync(path.join(tmpdir(), "muraqib-ext-"));
  const root = path.join(base, "ws");
  const outside = path.join(base, "outside.txt");
  mkdirSync(path.join(root, "src"), { recursive: true });
  writeFileSync(path.join(root, "src", "a.ts"), "x");
  writeFileSync(outside, "secret");
  const io: PathIo = { realpath: (p) => fs.realpath(p), isFile: async (p) => (await fs.stat(p)).isFile() };
  let symlinks = true;
  try {
    symlinkSync(outside, path.join(root, "escape.txt"));
  } catch {
    symlinks = false;
  }
  afterAll(() => rmSync(base, { recursive: true, force: true }));

  it("opens regular files and refuses symlink escapes and directories", async () => {
    const realRoot = await fs.realpath(root);
    await expect(resolveExistingFileInside(root, "src/a.ts", io)).resolves.toBe(path.join(realRoot, "src", "a.ts"));
    await expect(resolveExistingFileInside(root, "src", io)).resolves.toBeUndefined();
    await expect(resolveExistingFileInside(root, "../outside.txt", io)).resolves.toBeUndefined();
    if (symlinks) await expect(resolveExistingFileInside(root, "escape.txt", io)).resolves.toBeUndefined();
  });
});

describe("resolveOpenRequest", () => {
  const io: PathIo = { realpath: async (p) => p, isFile: async () => true };
  const reported = new Set(["src/a.ts", "../escape.ts"]);

  it("requires a workspace root and a file named by the report", async () => {
    const message = { type: "openFile", file: "src/a.ts" } as const;
    await expect(resolveOpenRequest(message, undefined, reported, io, path.posix)).resolves.toBeUndefined();
    await expect(resolveOpenRequest({ type: "openFile", file: "src/other.ts" }, "/w", reported, io, path.posix)).resolves.toBeUndefined();
  });

  it("returns the target with default and explicit positions", async () => {
    await expect(resolveOpenRequest({ type: "openFile", file: "src/a.ts" }, "/w", reported, io, path.posix)).resolves.toEqual({
      path: "/w/src/a.ts",
      line: 1,
      column: 1,
    });
    await expect(
      resolveOpenRequest({ type: "openFile", file: "src/a.ts", line: 7, column: 2 }, "/w", reported, io, path.posix)
    ).resolves.toMatchObject({ line: 7, column: 2 });
  });

  it("still rejects a traversal path even when the report lists it", async () => {
    await expect(resolveOpenRequest({ type: "openFile", file: "../escape.ts" }, "/w", reported, io, path.posix)).resolves.toBeUndefined();
  });
});
