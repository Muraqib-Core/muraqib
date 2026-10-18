import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectProjectPackageManager } from "../../../src/utils/manager-detector.js";

describe("detectProjectPackageManager", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "muraqib-pm-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("detects pnpm from pnpm-lock.yaml", () => {
    writeFileSync(join(dir, "pnpm-lock.yaml"), "");
    expect(detectProjectPackageManager(dir)).toBe("pnpm");
  });

  test("detects yarn from yarn.lock", () => {
    writeFileSync(join(dir, "yarn.lock"), "");
    expect(detectProjectPackageManager(dir)).toBe("yarn");
  });

  test("detects npm from package-lock.json", () => {
    writeFileSync(join(dir, "package-lock.json"), "{}");
    expect(detectProjectPackageManager(dir)).toBe("npm");
  });

  test("prefers pnpm over yarn and npm when several lockfiles exist", () => {
    writeFileSync(join(dir, "pnpm-lock.yaml"), "");
    writeFileSync(join(dir, "yarn.lock"), "");
    writeFileSync(join(dir, "package-lock.json"), "{}");
    expect(detectProjectPackageManager(dir)).toBe("pnpm");
  });

  test("falls back to npm when no lockfile exists", () => {
    expect(detectProjectPackageManager(dir)).toBe("npm");
  });

  test("defaults to the current working directory", () => {
    // The repository itself ships a package-lock.json.
    expect(detectProjectPackageManager()).toBe("npm");
  });
});

describe("detectProjectPackageManager: bun and the packageManager field", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "muraqib-pm-extra-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("detects bun from either bun lockfile", () => {
    writeFileSync(join(dir, "bun.lockb"), "");
    expect(detectProjectPackageManager(dir)).toBe("bun");
    rmSync(join(dir, "bun.lockb"));
    writeFileSync(join(dir, "bun.lock"), "");
    expect(detectProjectPackageManager(dir)).toBe("bun");
  });

  test("the packageManager field wins over lockfiles", () => {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ packageManager: "yarn@4.1.0" }));
    writeFileSync(join(dir, "package-lock.json"), "{}");
    expect(detectProjectPackageManager(dir)).toBe("yarn");
  });

  test("ignores an unknown packageManager value and an unreadable package.json", () => {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ packageManager: "deno@1" }));
    writeFileSync(join(dir, "pnpm-lock.yaml"), "");
    expect(detectProjectPackageManager(dir)).toBe("pnpm");
    writeFileSync(join(dir, "package.json"), "{ not json");
    expect(detectProjectPackageManager(dir)).toBe("pnpm");
  });
});
