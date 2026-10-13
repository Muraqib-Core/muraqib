import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ConfigGuard, performConfigAudit } from "./config-guard.js";
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

  it("requires .eslintignore when there is no flat ESLint config", () => {
    const result = performConfigAudit(tempDir);
    expect(result.configFiles.missing).toContain(".eslintignore");
  });

  it("reports a missing .eslintignore as a warning-level issue, not an error", async () => {
    const issue = performConfigAudit(tempDir).issues.find((i) => i.file === ".eslintignore");
    expect(issue?.severity).toBe("medium");
    const result = await new ConfigGuard({ projectRoot: tempDir }).execute();
    const mapped = result.issues.find((i) => i.title.includes(".eslintignore"));
    expect(mapped?.severity).toBe("warning");
  });

  it("keeps other missing critical configs at error severity", async () => {
    const result = await new ConfigGuard({ projectRoot: tempDir }).execute();
    expect(result.issues.find((i) => i.title.includes("tsconfig.json"))?.severity).toBe("error");
  });

  it.each(["eslint.config.js", "eslint.config.mjs", "eslint.config.cjs", "eslint.config.ts"])(
    "does not require .eslintignore when %s is present (ESLint 9 flat config)",
    (name) => {
      writeFileSync(join(tempDir, name), "export default [];");
      const result = performConfigAudit(tempDir);
      expect(result.configFiles.missing).not.toContain(".eslintignore");
      expect(result.issues.some((i) => i.file === ".eslintignore")).toBe(false);
      expect(result.configFiles.found).toContain(name);
    }
  );

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
