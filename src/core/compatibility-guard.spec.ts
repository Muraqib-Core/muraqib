import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { performCompatibilityAudit, CompatibilityGuard } from "./compatibility-guard.js";
import { writeFileSync, mkdirSync, rmSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
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

describe("Compatibility Guard regressions", () => {
  let dir: string;
  const write = (pkg: unknown): void =>
    writeFileSync(join(dir, "package.json"), typeof pkg === "string" ? pkg : JSON.stringify(pkg));

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "muraqib-compat-reg-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it.each(["{ invalid json }", "[]", "null", '"x"'])(
    "guard reports an error for unusable package.json %s",
    async (content) => {
      write(content);
      const result = await new CompatibilityGuard(dir).run();
      expect(result.status).toBe("issues");
      expect(result.issues.some((i) => i.code === "COMPATIBILITY_PACKAGE_JSON_INVALID")).toBe(true);
      expect(performCompatibilityAudit(dir).isCompatible).toBe(false);
    }
  );

  it("detects peer conflict (react ^18 peer vs 17.0.0 dev)", () => {
    write({ peerDependencies: { react: "^18.0.0" }, devDependencies: { react: "17.0.0" } });
    const r = performCompatibilityAudit(dir);
    expect(r.isCompatible).toBe(false);
    expect(r.findings.some((f) => f.code === "COMPATIBILITY_PEER_CONFLICT")).toBe(true);
  });

  it("accepts satisfying peer and ignores non-semver specs", () => {
    write({ peerDependencies: { react: "^18.0.0" }, devDependencies: { react: "^18.2.0" } });
    expect(performCompatibilityAudit(dir).isCompatible).toBe(true);
    for (const spec of ["workspace:*", "latest", "npm:preact@10", "git+https://x/y.git", "file:../r"]) {
      write({ peerDependencies: { react: "^18.0.0" }, devDependencies: { react: spec } });
      expect(performCompatibilityAudit(dir).isCompatible).toBe(true);
    }
  });

  it("does not treat peer range alone as installed", () => {
    write({ peerDependencies: { react: "^18.0.0" } });
    expect(performCompatibilityAudit(dir).isCompatible).toBe(true);
  });

  it.each([">=16", "^16.0.0", "14.x", "12.0.0"])("flags EOL engines.node %s", (range) => {
    write({ engines: { node: range } });
    const r = performCompatibilityAudit(dir);
    expect(r.isCompatible).toBe(false);
    expect(r.findings[0]?.code).toBe("COMPATIBILITY_EOL_NODE");
  });

  it.each([">=18.14", "20.14.0", ">=18", "not a range"])("does not flag engines.node %s", (range) => {
    write({ engines: { node: range } });
    expect(performCompatibilityAudit(dir).isCompatible).toBe(true);
  });

  it("emits deprecated-package warnings with warning status", async () => {
    write({ dependencies: { "node-fetch": "^3.0.0", uuid: "^9.0.0" } });
    const r = performCompatibilityAudit(dir);
    expect(r.isCompatible).toBe(true);
    expect(r.issues).toHaveLength(2);
    const result = await new CompatibilityGuard(dir).run();
    expect(result.status).toBe("warning");
    expect(result.issues).toHaveLength(2);
    expect(result.issues.every((i) => i.code === "COMPATIBILITY_DEPRECATED_PACKAGE" && i.severity === "warning")).toBe(true);
  });

  it("emits EOL as error and status ok when clean", async () => {
    write({ engines: { node: "14.x" } });
    const bad = await new CompatibilityGuard(dir).run();
    expect(bad.status).toBe("issues");
    expect(bad.issues[0]?.code).toBe("COMPATIBILITY_EOL_NODE");
    write({ engines: { node: ">=18" } });
    expect((await new CompatibilityGuard(dir).run()).status).toBe("ok");
  });
});
