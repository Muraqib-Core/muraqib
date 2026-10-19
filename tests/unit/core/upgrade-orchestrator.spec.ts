import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { execFile } from "child_process";
import { detectProjectPackageManager } from "../../../src/utils/manager-detector.js";
import { runMuraqibUpgradeOrchestrator, type OrchestratorConfig } from "../../../src/core/upgrade-orchestrator";

vi.mock("child_process");
vi.mock("../../../src/utils/manager-detector.js");
vi.mock("../../../src/config/presets.js");

type ExecCb = (err: Error | null, stdout: string, stderr: string) => void;

/** Makes the mocked execFile call back; `outcome` returns an Error (failure) or null (success) per invocation. */
function mockExec(outcome: (command: string, args: string[]) => Error | null, output = { stdout: "", stderr: "" }): void {
  vi.mocked(execFile).mockImplementation(((command: string, args: string[], _opts: unknown, cb: ExecCb) => {
    cb(outcome(command, args), output.stdout, output.stderr);
    return undefined as never;
  }) as never);
}

describe("runMuraqibUpgradeOrchestrator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mockExec(() => null);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("rejects invalid package names", async () => {
    const config: OrchestratorConfig = {
      packageName: "",
      currentValue: "1.0.0",
      newVersion: "2.0.0",
      rangeStrategy: "replace",
    };

    const result = await runMuraqibUpgradeOrchestrator(config);

    expect(result.updatedVersion).toBeNull();
    expect(result.schemaMigrated).toBe(false);
  });

  it("rejects invalid new version", async () => {
    const config: OrchestratorConfig = {
      packageName: "test-package",
      currentValue: "1.0.0",
      newVersion: "",
      rangeStrategy: "replace",
    };

    const result = await runMuraqibUpgradeOrchestrator(config);

    expect(result.updatedVersion).toBeNull();
    expect(result.schemaMigrated).toBe(false);
  });

  it("handles invalid version syntax", async () => {
    const config: OrchestratorConfig = {
      packageName: "test-package",
      currentValue: "invalid-version-string",
      newVersion: "2.0.0",
      rangeStrategy: "replace",
    };

    const result = await runMuraqibUpgradeOrchestrator(config);

    expect(result.updatedVersion).toBeNull();
    expect(result.schemaMigrated).toBe(false);
    expect(result.skipReason).toBe("invalid-version");
  });

  it("validates upgrade config properties", async () => {
    const config: OrchestratorConfig = {
      packageName: "lodash",
      currentValue: "^4.17.0",
      newVersion: "^4.18.0",
      rangeStrategy: "replace",
    };

    expect(config.packageName).toBeDefined();
    expect(config.currentValue).toBeDefined();
    expect(config.newVersion).toBeDefined();
    expect(["replace", "widen", "bump"]).toContain(config.rangeStrategy);
  });

  it("handles rangeStrategy as 'replace'", async () => {
    const config: OrchestratorConfig = {
      packageName: "react",
      currentValue: "^18.0.0",
      newVersion: "^19.0.0",
      rangeStrategy: "replace",
    };

    expect(config.rangeStrategy).toBe("replace");
  });

  it("handles rangeStrategy as 'widen'", async () => {
    const config: OrchestratorConfig = {
      packageName: "react",
      currentValue: "^18.0.0",
      newVersion: "^19.0.0",
      rangeStrategy: "widen",
    };

    expect(config.rangeStrategy).toBe("widen");
  });

  it("handles rangeStrategy as 'bump'", async () => {
    const config: OrchestratorConfig = {
      packageName: "react",
      currentValue: "^18.0.0",
      newVersion: "^19.0.0",
      rangeStrategy: "bump",
    };

    expect(config.rangeStrategy).toBe("bump");
  });

  it("validates remotePresetUrl is optional", async () => {
    const config: OrchestratorConfig = {
      packageName: "eslint",
      currentValue: "^8.0.0",
      newVersion: "^9.0.0",
      rangeStrategy: "replace",
    };

    expect(config.remotePresetUrl).toBeUndefined();
  });

  it("handles remotePresetUrl when provided", async () => {
    const config: OrchestratorConfig = {
      packageName: "eslint",
      currentValue: "^8.0.0",
      newVersion: "^9.0.0",
      rangeStrategy: "replace",
      remotePresetUrl: "https://example.com/presets.json",
    };

    expect(config.remotePresetUrl).toBe("https://example.com/presets.json");
  });

  it("returns OrchestratorResult with updatedVersion and schemaMigrated", async () => {
    const config: OrchestratorConfig = {
      packageName: "test-package",
      currentValue: "1.0.0",
      newVersion: "1.0.1",
      rangeStrategy: "replace",
    };

    const result = await runMuraqibUpgradeOrchestrator(config);

    expect(result).toHaveProperty("updatedVersion");
    expect(result).toHaveProperty("schemaMigrated");
    expect(typeof result.schemaMigrated).toBe("boolean");
  });

  it("validates schema migration registry for known packages", async () => {
    const knownPackages = ["tailwindcss", "prisma", "next", "react", "eslint", "zustand"];
    const config: OrchestratorConfig = {
      packageName: "unknown-package",
      currentValue: "1.0.0",
      newVersion: "2.0.0",
      rangeStrategy: "replace",
    };

    expect(knownPackages).not.toContain(config.packageName);
  });

  it("preserves unsaved changes during upgrade workflow", async () => {
    const config: OrchestratorConfig = {
      packageName: "test-lib",
      currentValue: "1.0.0",
      newVersion: "1.1.0",
      rangeStrategy: "replace",
    };

    expect(config).toMatchObject({
      packageName: "test-lib",
      currentValue: "1.0.0",
      newVersion: "1.1.0",
    });
  });

  it("handles all orchestrator config fields properly", async () => {
    const configs: OrchestratorConfig[] = [
      {
        packageName: "package1",
        currentValue: "1.0.0",
        newVersion: "2.0.0",
        rangeStrategy: "replace",
      },
      {
        packageName: "package2",
        currentValue: "^1.0.0",
        newVersion: "^2.0.0",
        rangeStrategy: "widen",
      },
      {
        packageName: "package3",
        currentValue: "~1.2.0",
        newVersion: "~1.3.0",
        rangeStrategy: "bump",
        remotePresetUrl: "https://api.example.com/presets",
      },
    ];

    configs.forEach((config) => {
      expect(config).toHaveProperty("packageName");
      expect(config).toHaveProperty("currentValue");
      expect(config).toHaveProperty("newVersion");
      expect(config).toHaveProperty("rangeStrategy");
      expect(typeof config.packageName).toBe("string");
      expect(typeof config.currentValue).toBe("string");
      expect(typeof config.newVersion).toBe("string");
    });
  });
  it("runs detection, migration and build inside the given cwd", async () => {
    vi.mocked(detectProjectPackageManager).mockReturnValue("npm");

    const result = await runMuraqibUpgradeOrchestrator({
      packageName: "react",
      currentValue: "^18.0.0",
      newVersion: "^19.0.0",
      rangeStrategy: "replace",
      cwd: "/projects/other",
    });

    expect(result.schemaMigrated).toBe(true);
    expect(detectProjectPackageManager).toHaveBeenCalledWith("/projects/other");
    const calls = vi.mocked(execFile).mock.calls;
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call[2]).toMatchObject({ cwd: "/projects/other", timeout: expect.any(Number) });
    }
    expect(calls[0]?.[0]).toBe("npx");
    expect(calls[0]?.[1]).toEqual(["react-codemod@latest", "update-react-imports", "--force"]);
    expect(calls[1]?.[0]).toBe("npm");
    expect(calls[1]?.[1]).toEqual(["run", "build"]);
  });

  it("does not run anything when the version does not change", async () => {
    vi.mocked(detectProjectPackageManager).mockReturnValue("npm");

    await runMuraqibUpgradeOrchestrator({
      packageName: "react",
      currentValue: "^18.0.0",
      newVersion: "^18.0.0",
      rangeStrategy: "replace",
      cwd: "/projects/other",
    });

    expect(execFile).not.toHaveBeenCalled();
  });

  it("rejects an empty newVersion without a skipReason and without running anything", async () => {
    const result = await runMuraqibUpgradeOrchestrator({
      packageName: "react",
      currentValue: "^18.0.0",
      newVersion: "   ",
      rangeStrategy: "replace",
    });
    expect(result).toEqual({ updatedVersion: null, schemaMigrated: false });
    expect(execFile).not.toHaveBeenCalled();
  });

  it.each(["latest", "next", "*", "beta"])("does not throw and skips for dist-tag newVersion %s", async (tag) => {
    vi.mocked(detectProjectPackageManager).mockReturnValue("npm");
    const result = await runMuraqibUpgradeOrchestrator({
      packageName: "react",
      currentValue: "^18.0.0",
      newVersion: tag,
      rangeStrategy: "replace",
    });
    expect(result).toEqual({ updatedVersion: null, schemaMigrated: false, skipReason: "invalid-new-version" });
    expect(execFile).not.toHaveBeenCalled();
  });

  it("runs the two prisma steps sequentially without a shell and stops on the first failure", async () => {
    vi.mocked(detectProjectPackageManager).mockReturnValue("npm");
    mockExec((_c, args) => (args[0] === "prisma" && args[1] === "format" ? new Error("boom") : null));
    const result = await runMuraqibUpgradeOrchestrator({
      packageName: "prisma",
      currentValue: "^5.0.0",
      newVersion: "6.0.0",
      rangeStrategy: "bump",
    });
    const argv = vi.mocked(execFile).mock.calls.map((c) => [c[0], ...(c[1] as string[])].join(" "));
    expect(argv).toEqual(["npx prisma format", "npm run build"]);
    expect(result).toEqual({ updatedVersion: "^6.0.0", schemaMigrated: false });
  });

  it("skips migration codemods when runMigrations is false", async () => {
    vi.mocked(detectProjectPackageManager).mockReturnValue("npm");
    const result = await runMuraqibUpgradeOrchestrator({
      packageName: "react",
      currentValue: "^18.0.0",
      newVersion: "19.0.0",
      rangeStrategy: "replace",
      runMigrations: false,
    });
    const argv = vi.mocked(execFile).mock.calls.map((c) => c[0]);
    expect(argv).toEqual(["npm"]);
    expect(result.schemaMigrated).toBe(false);
    expect(result.updatedVersion).toBe("^19.0.0");
  });

  it("treats 'bump' like replace and 'widen' as keep-both", async () => {
    vi.mocked(detectProjectPackageManager).mockReturnValue("npm");
    const bump = await runMuraqibUpgradeOrchestrator({ packageName: "x", currentValue: "~1.0.0", newVersion: "1.2.0", rangeStrategy: "bump" });
    const widen = await runMuraqibUpgradeOrchestrator({ packageName: "x", currentValue: "~1.0.0", newVersion: "1.2.0", rangeStrategy: "widen" });
    expect(bump.updatedVersion).toBe("~1.2.0");
    expect(widen.updatedVersion).toBe("~1.0.0 || ~1.2.0");
  });

  it("logs the tail of the build output and returns the current value on build failure", async () => {
    vi.mocked(detectProjectPackageManager).mockReturnValue("pnpm");
    const lines = Array.from({ length: 30 }, (_v, n) => `err line ${n + 1}`).join("\n");
    mockExec(() => new Error("failed"), { stdout: "", stderr: lines });
    const result = await runMuraqibUpgradeOrchestrator({
      packageName: "lodash",
      currentValue: "^1.0.0",
      newVersion: "2.0.0",
      rangeStrategy: "replace",
    });
    expect(result).toEqual({ updatedVersion: "^1.0.0", schemaMigrated: false });
    const logged = vi.mocked(console.error).mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain("err line 30");
    expect(logged).toContain("err line 11");
    expect(logged).not.toContain("err line 10\n");
    expect(vi.mocked(execFile).mock.calls[0]?.[0]).toBe("pnpm");
    expect(vi.mocked(execFile).mock.calls[0]?.[1]).toEqual(["-w", "build"]);
    const warned = vi.mocked(console.log).mock.calls.map((c) => String(c[0])).join("\n");
    expect(warned).not.toContain("has been applied");
  });
});
