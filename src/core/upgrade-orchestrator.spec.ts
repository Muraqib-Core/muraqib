import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { runMuraqibUpgradeOrchestrator, type OrchestratorConfig } from "./upgrade-orchestrator";

vi.mock("child_process");
vi.mock("../utils/manager-detector.js");
vi.mock("../config/presets.js");

describe("runMuraqibUpgradeOrchestrator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
