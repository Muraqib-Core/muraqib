import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { performConfigAudit } from "./config-guard.js";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";

describe("Config Guard", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(process.cwd(), `.temp-config-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it("detects missing critical configs", () => {
    const result = performConfigAudit(tempDir);
    expect(result.isHealthy).toBe(false);
    expect(
      result.issues.some((i) => i.type === "missing_config")
    ).toBe(true);
  });

  it("validates valid package.json", () => {
    const packageJson = {
      name: "test-project",
      version: "1.0.0",
      description: "Test project",
      license: "MIT",
      engines: { node: ">=18.0.0" },
      scripts: { test: "vitest" },
    };

    writeFileSync(join(tempDir, "package.json"), JSON.stringify(packageJson));
    const result = performConfigAudit(tempDir);

    const packageIssues = result.issues.filter((i) => i.file === "package.json");
    expect(packageIssues.length).toBe(0);
  });

  it("detects invalid JSON in package.json", () => {
    writeFileSync(join(tempDir, "package.json"), "{ invalid json }");
    const result = performConfigAudit(tempDir);

    expect(result.issues.some((i) => i.type === "invalid_json")).toBe(true);
  });

  it("detects missing package.json fields", () => {
    const packageJson = {
      name: "test-project",
      version: "1.0.0",
    };

    writeFileSync(join(tempDir, "package.json"), JSON.stringify(packageJson));
    const result = performConfigAudit(tempDir);

    const missingIssues = result.issues.filter(
      (i) => i.type === "missing_config"
    );
    expect(missingIssues.length).toBeGreaterThan(0);
  });

  it("detects unsafe TypeScript config", () => {
    const tsconfig = {
      compilerOptions: {
        strict: false,
        noImplicitAny: false,
      },
    };

    writeFileSync(join(tempDir, "tsconfig.json"), JSON.stringify(tsconfig));
    const result = performConfigAudit(tempDir);

    expect(
      result.issues.some((i) => i.setting === "noImplicitAny")
    ).toBe(true);
  });

  it("accepts safe TypeScript config", () => {
    const tsconfig = {
      compilerOptions: {
        strict: true,
        noImplicitAny: true,
        target: "ES2022",
        module: "ESNext",
      },
    };

    writeFileSync(join(tempDir, "tsconfig.json"), JSON.stringify(tsconfig));
    const result = performConfigAudit(tempDir);

    const typeScriptIssues = result.issues.filter(
      (i) => i.file === "tsconfig.json"
    );
    expect(typeScriptIssues.length).toBe(0);
  });

  it("finds both found and missing configs", () => {
    const packageJson = {
      name: "test",
      version: "1.0.0",
      engines: { node: ">=18.0.0" },
      scripts: { test: "vitest" },
    };

    writeFileSync(join(tempDir, "package.json"), JSON.stringify(packageJson));
    const result = performConfigAudit(tempDir);

    expect(result.configFiles.found.includes("package.json")).toBe(true);
    expect(result.configFiles.missing.length).toBeGreaterThan(0);
  });
});
