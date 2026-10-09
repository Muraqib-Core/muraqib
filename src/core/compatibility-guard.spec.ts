import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { performCompatibilityAudit } from "./compatibility-guard.js";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";

describe("Compatibility Guard", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(process.cwd(), `.temp-compat-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it("detects missing package.json", () => {
    const result = performCompatibilityAudit(tempDir);
    expect(result.isCompatible).toBe(true);
    expect(result.reports.some((r) => r.includes("No package.json"))).toBe(
      true
    );
  });

  it("detects EOL Node.js versions", () => {
    const packageJson = {
      name: "test-project",
      version: "1.0.0",
      engines: { node: "14.x" },
    };

    writeFileSync(join(tempDir, "package.json"), JSON.stringify(packageJson));
    const result = performCompatibilityAudit(tempDir);

    expect(result.isCompatible).toBe(false);
    expect(result.reports.some((r) => r.includes("EOL"))).toBe(true);
  });

  it("accepts supported Node.js versions", () => {
    const packageJson = {
      name: "test-project",
      version: "1.0.0",
      engines: { node: "18.x" },
    };

    writeFileSync(join(tempDir, "package.json"), JSON.stringify(packageJson));
    const result = performCompatibilityAudit(tempDir);

    expect(result.isCompatible).toBe(true);
  });

  it("detects deprecated packages", () => {
    const packageJson = {
      name: "test-project",
      version: "1.0.0",
      dependencies: { "node-fetch": "^3.0.0" },
    };

    writeFileSync(join(tempDir, "package.json"), JSON.stringify(packageJson));
    const result = performCompatibilityAudit(tempDir);

    expect(result.reports.some((r) => r.includes("Deprecated"))).toBe(true);
  });

  it("scans dependencies without errors", () => {
    const packageJson = {
      name: "test-project",
      version: "1.0.0",
      dependencies: { react: "18.0.0", "uuid": "^9.0.0" },
      devDependencies: { vitest: "^2.0.0" },
    };

    writeFileSync(join(tempDir, "package.json"), JSON.stringify(packageJson));
    const result = performCompatibilityAudit(tempDir);

    expect(result.isCompatible).toBeDefined();
    expect(Array.isArray(result.reports)).toBe(true);
  });

  it("handles invalid JSON gracefully", () => {
    writeFileSync(join(tempDir, "package.json"), "{ invalid json }");
    const result = performCompatibilityAudit(tempDir);

    expect(result.isCompatible).toBe(false);
    expect(result.reports.some((r) => r.includes("Failed"))).toBe(true);
  });
});

describe("CompatibilityGuard cross-package rules (scan engine)", () => {
  it("reports Next.js x React 19 conflicts via CompatibilityEngine", async () => {
    const { mkdtempSync, writeFileSync } = await import("fs");
    const { tmpdir } = await import("os");
    const { join } = await import("path");
    const dir = mkdtempSync(join(tmpdir(), "muraqib-compat-"));
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: "x", dependencies: { react: "19.0.0", next: "14.0.1" } })
    );
    const { CompatibilityGuard } = await import("./compatibility-guard.js");
    const result = await new CompatibilityGuard(dir).run();
    expect(result.status).toBe("issues");
    expect(result.issues.some((i) => i.message.includes("React 19"))).toBe(true);
  });
});
