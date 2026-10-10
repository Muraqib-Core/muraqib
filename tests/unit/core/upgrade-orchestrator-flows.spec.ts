import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("child_process", () => ({ execSync: vi.fn() }));
vi.mock("../../../src/utils/manager-detector.js", () => ({
  detectProjectPackageManager: vi.fn(),
}));
vi.mock("../../../src/config/presets.js", () => ({
  MURAQIB_LOCAL_PRESETS: [{ groupName: "react-core-suite", packages: ["react", "react-dom"] }],
  fetchRemoteMuraqibPresets: vi.fn(),
}));

import { execSync } from "child_process";
import { detectProjectPackageManager } from "../../../src/utils/manager-detector.js";
import { fetchRemoteMuraqibPresets } from "../../../src/config/presets.js";
import { runMuraqibUpgradeOrchestrator } from "../../../src/core/upgrade-orchestrator.js";

const run = (over: Partial<Parameters<typeof runMuraqibUpgradeOrchestrator>[0]> = {}) =>
  runMuraqibUpgradeOrchestrator({
    packageName: "lodash",
    currentValue: "^1.0.0",
    newVersion: "2.0.0",
    rangeStrategy: "replace",
    ...over,
  });

describe("upgrade orchestrator flows", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(detectProjectPackageManager).mockReturnValue("npm");
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  test("rejects an empty new version", async () => {
    const result = await run({ newVersion: "  " });
    expect(result.updatedVersion).toBeNull();
  });

  test("skips packages whose current version cannot be parsed", async () => {
    const result = await run({ currentValue: "workspace:*" });
    expect(result).toMatchObject({ updatedVersion: null, skipReason: "invalid-version" });
  });

  test("bumps the version and runs the build for the detected manager", async () => {
    const result = await run();
    expect(result.updatedVersion).toBe("^2.0.0");
    expect(execSync).toHaveBeenCalledWith("npm run build", { stdio: "ignore" });
  });

  test.each([
    ["yarn", "yarn build"],
    ["pnpm", "pnpm -w build"],
    ["unknown", "npm run build"],
  ])("uses the %s build command", async (manager, command) => {
    vi.mocked(detectProjectPackageManager).mockReturnValue(manager as never);
    await run();
    expect(execSync).toHaveBeenCalledWith(command, { stdio: "ignore" });
  });

  test("reports the matching preset group, fetching remote presets when a url is given", async () => {
    vi.mocked(fetchRemoteMuraqibPresets).mockResolvedValue([
      { groupName: "remote-group", packages: ["lodash"] },
    ]);
    await run({ remotePresetUrl: "http://presets" });
    expect(fetchRemoteMuraqibPresets).toHaveBeenCalledWith("http://presets");
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("remote-group"));
  });

  test("ignores a blank remote preset url and uses local presets", async () => {
    await run({ packageName: "react", currentValue: "^18.0.0", newVersion: "18.3.0", remotePresetUrl: " " });
    expect(fetchRemoteMuraqibPresets).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("react-core-suite"));
  });

  test("runs the schema migration for a breaking major and records success", async () => {
    const result = await run({ packageName: "tailwindcss", currentValue: "^3.4.0", newVersion: "4.0.0" });
    expect(result.schemaMigrated).toBe(true);
    expect(execSync).toHaveBeenCalledWith(
      expect.stringContaining("@tailwindcss/upgrade"),
      { stdio: "inherit" }
    );
  });

  test("continues to the build when the migration command fails", async () => {
    vi.mocked(execSync).mockImplementationOnce(() => {
      throw new Error("codemod failed");
    });
    const result = await run({ packageName: "prisma", currentValue: "^5.0.0", newVersion: "6.0.0" });
    expect(result.schemaMigrated).toBe(false);
    expect(result.updatedVersion).toBe("^6.0.0");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("schema migration failed"));
  });

  test("returns the original version when the build fails", async () => {
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error("build failed");
    });
    const result = await run();
    expect(result).toEqual({ updatedVersion: "^1.0.0", schemaMigrated: false });
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("Integrity Failure"));
  });

  test("does nothing when the new version is not newer", async () => {
    const result = await run({ currentValue: "^2.0.0", newVersion: "1.0.0" });
    expect(execSync).not.toHaveBeenCalled();
    expect(result.schemaMigrated).toBe(false);
  });

  test("uses keep-both for the widen strategy", async () => {
    const result = await run({ rangeStrategy: "widen" });
    expect(result.updatedVersion).toContain("2.0.0");
  });
});
