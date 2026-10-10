import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

vi.mock("../../src/scan/guard/env-validator.js", () => ({ createEnv: vi.fn() }));
vi.mock("../../src/scan/scanners/dependency/osv-engine.js", () => ({ OsvScanner: vi.fn() }));
vi.mock("../../src/scan/scanners/compatibility/compatibility-engine.js", () => ({
  CompatibilityEngine: vi.fn(),
}));
vi.mock("../../src/scan/scanners/docker/docker-engine.js", () => ({ DockerScanner: vi.fn() }));
vi.mock("../../src/scan/ai/fallback.js", () => ({ analyzeUnknownVariablesWithAi: vi.fn() }));
vi.mock("../../src/scan/ai/advisor.js", () => ({ generateAdvisory: vi.fn() }));

import { createEnv } from "../../src/scan/guard/env-validator.js";
import { EnvValidationError } from "../../src/scan/guard/errors/env-validation-error.js";
import { OsvScanner } from "../../src/scan/scanners/dependency/osv-engine.js";
import { CompatibilityEngine } from "../../src/scan/scanners/compatibility/compatibility-engine.js";
import { DockerScanner } from "../../src/scan/scanners/docker/docker-engine.js";
import { analyzeUnknownVariablesWithAi } from "../../src/scan/ai/fallback.js";
import { generateAdvisory } from "../../src/scan/ai/advisor.js";
import { AuditRunner } from "../../src/scan/core/runner/audit-runner.js";
import { createScanIssue } from "../../src/scan/core/findings/finding.js";
import type { ProjectContext } from "../../src/scan/core/context/project-context.js";

type ScanResultStub = {
  scanner: string;
  status: "success" | "partial" | "failed" | "unavailable";
  findings: unknown[];
  error?: string;
  diagnostics?: string[];
};

function stubScanner(
  ctor: unknown,
  name: string,
  supports: boolean,
  result: Partial<ScanResultStub> = {}
): void {
  vi.mocked(ctor as never as typeof OsvScanner).mockImplementation(function () {
    return {
      name,
      supports: () => supports,
      scan: async () => ({ scanner: name, status: "success", findings: [], ...result }),
    } as never;
  });
}

const highFinding = createScanIssue({
  id: "f1",
  title: "t",
  message: "m",
  severity: "high",
  category: "security",
  source: "osv",
});

describe("AuditRunner", () => {
  let dir = "";

  const context = (overrides: Partial<ProjectContext> = {}): ProjectContext => ({
    projectPath: dir,
    packageManager: "npm",
    nodeVersion: "20",
    files: [],
    envFiles: [],
    dependencies: {},
    devDependencies: {},
    dockerfiles: [],
    composeFiles: [],
    dockerignoreFiles: [],
    ...overrides,
  });

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "muraqib-runner-"));
    vi.mocked(createEnv).mockReset();
    vi.mocked(createEnv).mockResolvedValue({ engine: "zod", unknownKeys: [] } as never);
    vi.mocked(analyzeUnknownVariablesWithAi).mockReset();
    vi.mocked(generateAdvisory).mockReset();
    stubScanner(OsvScanner, "osv", false);
    stubScanner(CompatibilityEngine, "compat", false);
    stubScanner(DockerScanner, "docker", false);
    vi.stubEnv("GEMINI_API_KEY", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("returns a clean report when nothing is found", async () => {
    const report = await new AuditRunner().run(context());
    expect(report).toMatchObject({
      findings: [],
      engine: "custom",
      mode: "build",
      hasBlockingIssues: false,
      exitCode: 0,
      aiAdvisory: null,
      scannerCoverage: [],
    });
    expect(createEnv).not.toHaveBeenCalled();
  });

  test("parses env files, validates them and records the engine", async () => {
    fs.writeFileSync(path.join(dir, ".env"), "A=1\nB=2\n");
    const report = await new AuditRunner().run(context({ envFiles: [".env"] }), { engine: "zod" });
    expect(report.totalParsedLines).toBe(2);
    expect(report.engine).toBe("zod");
    expect(report.scannedEnvFiles).toEqual([".env"]);
    expect(createEnv).toHaveBeenCalledWith(
      expect.objectContaining({ runtimeEnvStrict: { A: "1", B: "2" } })
    );
  });

  test("turns env validation errors into blocking preset-violation findings", async () => {
    fs.writeFileSync(path.join(dir, ".env"), "PORT=abc\n");
    vi.mocked(createEnv).mockRejectedValue(
      new EnvValidationError(
        "bad",
        [
          { path: ["PORT"], message: "must be numeric" },
          { path: [], message: "no field" },
        ] as never,
        ["X"],
        "valibot"
      )
    );
    const report = await new AuditRunner().run(context({ envFiles: [".env"] }));
    expect(report.engine).toBe("valibot");
    expect(report.findings.map((f) => f.code)).toEqual(
      expect.arrayContaining(["preset-violation-PORT", "preset-violation-UNKNOWN"])
    );
    const port = report.findings.find((f) => f.code === "preset-violation-PORT");
    expect(port?.location).toEqual({ file: ".env", line: 1 });
    expect(report.hasBlockingIssues).toBe(true);
    expect(report.exitCode).toBe(1);
  });

  test("rethrows unexpected validation failures with context", async () => {
    fs.writeFileSync(path.join(dir, ".env"), "A=1\n");
    vi.mocked(createEnv).mockRejectedValue(new Error("engine crashed"));
    await expect(new AuditRunner().run(context({ envFiles: [".env"] }))).rejects.toThrow(
      "Environment validation execution failed: engine crashed"
    );
  });

  test("throws a readable error when an env file cannot be read", async () => {
    await expect(new AuditRunner().run(context({ envFiles: ["missing.env"] }))).rejects.toThrow(
      "Failed to read environment file missing.env"
    );
  });

  test("adds AI findings for unknown variables when AI is enabled and keyed", async () => {
    fs.writeFileSync(path.join(dir, ".env"), "ODD=1\n");
    vi.stubEnv("GEMINI_API_KEY", "key");
    vi.mocked(createEnv).mockResolvedValue({ engine: "zod", unknownKeys: ["ODD"] } as never);
    vi.mocked(analyzeUnknownVariablesWithAi).mockResolvedValue([
      { path: ["ODD"], message: "suspicious" },
      { path: [], message: "other" },
    ]);
    const report = await new AuditRunner().run(context({ envFiles: [".env"] }), { enableAi: true });
    expect(report.findings.map((f) => f.code)).toEqual(
      expect.arrayContaining(["ai-finding-ODD", "ai-finding-UNKNOWN"])
    );
  });

  test("does not call the AI without an API key", async () => {
    fs.writeFileSync(path.join(dir, ".env"), "ODD=1\n");
    vi.mocked(createEnv).mockResolvedValue({ engine: "zod", unknownKeys: ["ODD"] } as never);
    await new AuditRunner().run(context({ envFiles: [".env"] }), { enableAi: true });
    expect(analyzeUnknownVariablesWithAi).not.toHaveBeenCalled();
  });

  test("collects scanner findings and coverage from supported scanners", async () => {
    stubScanner(OsvScanner, "osv", true, { findings: [highFinding] });
    stubScanner(CompatibilityEngine, "compat", true);
    stubScanner(DockerScanner, "docker", true);
    const report = await new AuditRunner().run(context());
    expect(report.scannerCoverage.map((c) => c.scanner)).toEqual(["osv", "compat", "docker"]);
    expect(report.findings.map((f) => f.code)).toContain("f1");
    expect(report.exitCode).toBe(1);
  });

  test("reports a failed scanner as a finding and exit code 3", async () => {
    stubScanner(OsvScanner, "osv", true, { status: "failed", error: "down", diagnostics: ["d"] });
    stubScanner(CompatibilityEngine, "compat", true, { status: "failed" });
    stubScanner(DockerScanner, "docker", true, { status: "failed" });
    const report = await new AuditRunner().run(context());
    expect(report.findings.map((f) => f.code)).toEqual(
      expect.arrayContaining(["scanner-osv-failed", "scanner-compat-failed", "scanner-docker-failed"])
    );
    expect(report.exitCode).toBe(3);
  });

  test("reports partial OSV and Docker scans as medium findings", async () => {
    stubScanner(OsvScanner, "osv", true, { status: "partial" });
    stubScanner(DockerScanner, "docker", true, { status: "partial", error: "some skipped" });
    const report = await new AuditRunner().run(context());
    expect(report.findings.map((f) => f.code)).toEqual(
      expect.arrayContaining(["scanner-osv-partial", "scanner-docker-partial"])
    );
    expect(report.exitCode).toBe(0);
  });

  test("treats medium findings as blocking only in prod mode", async () => {
    stubScanner(OsvScanner, "osv", true, { status: "partial" });
    const build = await new AuditRunner().run(context(), { mode: "build" });
    const prod = await new AuditRunner().run(context(), { mode: "prod" });
    expect(build.hasBlockingIssues).toBe(false);
    expect(prod.hasBlockingIssues).toBe(true);
    expect(prod.mode).toBe("prod");
  });

  test("passes the dockerNative flag to the docker scanner", async () => {
    await new AuditRunner().run(context(), { dockerNative: true });
    expect(vi.mocked(DockerScanner)).toHaveBeenCalledWith(undefined, true);
  });

  test("requests an AI advisory for security findings when AI is enabled", async () => {
    stubScanner(OsvScanner, "osv", true, { findings: [highFinding] });
    vi.stubEnv("GEMINI_API_KEY", "key");
    vi.mocked(generateAdvisory).mockResolvedValue("upgrade it");
    const report = await new AuditRunner().run(
      context({ dependencies: { a: "1" }, devDependencies: { b: "2" } }),
      { enableAi: true }
    );
    expect(report.aiAdvisory).toBe("upgrade it");
    expect(generateAdvisory).toHaveBeenCalledWith(expect.any(Array), { a: "1", b: "2" });
  });
});
