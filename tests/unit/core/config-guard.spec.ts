import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ConfigGuard, performConfigAudit } from "../../../src/core/config-guard.js";
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

  it("keeps other missing critical configs at error severity (TypeScript project)", async () => {
    writeFileSync(join(tempDir, "package.json"), JSON.stringify({ devDependencies: { typescript: "^5.0.0" } }));
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

  describe("missing tsconfig.json severity", () => {
    it("is high for projects with typescript in devDependencies", () => {
      writeFileSync(join(tempDir, "package.json"), JSON.stringify({ devDependencies: { typescript: "^5" } }));
      expect(performConfigAudit(tempDir).issues.find((i) => i.file === "tsconfig.json")?.severity).toBe("high");
    });

    it("is high when .ts files exist in src", () => {
      mkdirSync(join(tempDir, "src"));
      writeFileSync(join(tempDir, "src", "a.ts"), "export const a = 1;");
      expect(performConfigAudit(tempDir).issues.find((i) => i.file === "tsconfig.json")?.severity).toBe("high");
    });

    it("is high when .tsx files exist in the root", () => {
      writeFileSync(join(tempDir, "App.tsx"), "export default null;");
      expect(performConfigAudit(tempDir).issues.find((i) => i.file === "tsconfig.json")?.severity).toBe("high");
    });

    it("is low (and still recorded as missing) for pure-JS projects", async () => {
      writeFileSync(join(tempDir, "package.json"), JSON.stringify({ name: "js" }));
      writeFileSync(join(tempDir, "index.js"), "module.exports = 1;");
      const audit = performConfigAudit(tempDir);
      expect(audit.configFiles.missing).toContain("tsconfig.json");
      const issue = audit.issues.find((i) => i.file === "tsconfig.json");
      expect(issue).toMatchObject({ type: "missing_config", severity: "low" });
      const result = await new ConfigGuard({ projectRoot: tempDir }).execute();
      expect(result.issues.find((i) => i.title.includes("tsconfig.json"))?.severity).toBe("info");
    });
  });

  it("raises a medium missing_config issue for a missing .gitignore", async () => {
    const audit = performConfigAudit(tempDir);
    expect(audit.configFiles.missing).toContain(".gitignore");
    expect(audit.issues.find((i) => i.file === ".gitignore")).toMatchObject({ type: "missing_config", severity: "medium" });
    const result = await new ConfigGuard({ projectRoot: tempDir }).execute();
    expect(result.issues.find((i) => i.title.includes(".gitignore"))?.severity).toBe("warning");
  });

  it("emits semantic tags: config, issue type and setting", async () => {
    writeFileSync(join(tempDir, "package.json"), JSON.stringify({ name: "t" }));
    const result = await new ConfigGuard({ projectRoot: tempDir }).execute();
    const issue = result.issues.find((i) => i.title.includes("scripts.test"));
    expect(issue?.tags).toEqual(["config", "missing_config", "scripts.test"]);
    const noSetting = result.issues.find((i) => i.title.includes(".gitignore"));
    expect(noSetting?.tags).toEqual(["config", "missing_config"]);
  });

  it("reports invalid package.json once and skips field checks", () => {
    writeFileSync(join(tempDir, "package.json"), "{ nope");
    const audit = performConfigAudit(tempDir);
    expect(audit.issues.filter((i) => i.type === "invalid_json" && i.file === "package.json")).toHaveLength(1);
    expect(audit.issues.some((i) => i.file === "package.json" && i.type === "missing_config")).toBe(false);
  });

  it("treats a non-object package.json (e.g. null) as having no fields without crashing", () => {
    writeFileSync(join(tempDir, "package.json"), "null");
    expect(() => performConfigAudit(tempDir)).not.toThrow();
  });

  it("falls back to cwd for an empty or blank projectRoot", () => {
    const blank = performConfigAudit("   ");
    const cwd = performConfigAudit(process.cwd());
    expect(blank.configFiles.found).toEqual(cwd.configFiles.found);
    expect(performConfigAudit("").configFiles.found).toEqual(cwd.configFiles.found);
  });

  it("reports an unreadable tsconfig message without unsafe casts", () => {
    writeFileSync(join(tempDir, "tsconfig.json"), "{ nope");
    const issue = performConfigAudit(tempDir).issues.find((i) => i.type === "invalid_json" && i.file === "tsconfig.json");
    expect(issue?.message).toMatch(/^Invalid JSON in tsconfig\.json: /);
  });
});
