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
