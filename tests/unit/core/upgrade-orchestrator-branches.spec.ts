import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("child_process", () => ({ execFile: vi.fn() }));
vi.mock("../../../src/utils/manager-detector.js", () => ({
  detectProjectPackageManager: vi.fn(),
}));
vi.mock("../../../src/config/presets.js", () => ({
  MURAQIB_LOCAL_PRESETS: [{ groupName: "local-group", packages: ["react"] }],
  fetchRemoteMuraqibPresets: vi.fn(),
}));

import { execFile } from "child_process";
import { detectProjectPackageManager } from "../../../src/utils/manager-detector.js";
import { fetchRemoteMuraqibPresets } from "../../../src/config/presets.js";
import { runMuraqibUpgradeOrchestrator } from "../../../src/core/upgrade-orchestrator.js";

type Reply = { err?: Error | null | undefined; out?: string | undefined; errOut?: string | undefined };
type Responder = (command: string, args: string[]) => Reply;
type Callback = (e: Error | null | undefined, so: string | undefined, se: string | undefined) => void;

const mockExec = (responder: Responder = () => ({ err: null })): void => {
  vi.mocked(execFile).mockImplementation(((command: string, args: string[], _o: unknown, cb: Callback) => {
    const r = responder(command, args);
    cb(r.err, r.out, r.errOut);
    return undefined as never;
  }) as never);
};

type Config = Parameters<typeof runMuraqibUpgradeOrchestrator>[0];
const run = (over: Partial<Config> = {}) =>
  runMuraqibUpgradeOrchestrator({
    packageName: "lodash",
    currentValue: "^1.0.0",
    newVersion: "2.0.0",
    rangeStrategy: "replace",
    ...over,
  });

describe("upgrade orchestrator branches", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(detectProjectPackageManager).mockReturnValue("npm");
    mockExec();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("rejects an empty or non-string package name", async () => {
    expect(await run({ packageName: "  " })).toEqual({ updatedVersion: null, schemaMigrated: false });
    expect(await run({ packageName: 5 as unknown as string })).toEqual({ updatedVersion: null, schemaMigrated: false });
  });

  test("rejects a non-string new version", async () => {
    expect(await run({ newVersion: undefined as unknown as string })).toEqual({ updatedVersion: null, schemaMigrated: false });
  });

  test("skips an unparseable new version", async () => {
    expect(await run({ newVersion: "latest" })).toMatchObject({ updatedVersion: null, skipReason: "invalid-new-version" });
  });

  test("does nothing when the version is unchanged", async () => {
    const result = await run({ currentValue: "^2.0.0", newVersion: "2.0.0" });
    expect(result).toEqual({ updatedVersion: "^2.0.0", schemaMigrated: false });
    expect(execFile).not.toHaveBeenCalled();
  });

  test.each(["widen", "bump", "replace"] as const)("handles the %s range strategy", async (rangeStrategy) => {
    const result = await run({ rangeStrategy });
    expect(result.updatedVersion).toContain("2.0.0");
  });

  test("ignores a blank remote preset url and logs local preset group", async () => {
    await run({ packageName: "react", currentValue: "^18.0.0", newVersion: "18.3.0", remotePresetUrl: "   " });
    expect(fetchRemoteMuraqibPresets).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("local-group"));
  });

  test("uses a custom cwd and tolerates undefined execFile output", async () => {
    mockExec(() => ({ err: undefined, out: undefined, errOut: undefined }));
    const result = await run({ cwd: "/some/dir" });
    expect(result.updatedVersion).toBe("^2.0.0");
    expect(vi.mocked(execFile).mock.calls[0]?.[2]).toMatchObject({ cwd: "/some/dir" });
  });

  test("runs a single-step migration successfully", async () => {
    const result = await run({ packageName: "tailwindcss", currentValue: "^3.0.0", newVersion: "4.0.0" });
    expect(result).toEqual({ updatedVersion: "^4.0.0", schemaMigrated: true });
  });

  test("runs a multi-step migration in order", async () => {
    await run({ packageName: "prisma", currentValue: "^5.0.0", newVersion: "6.0.0" });
    const calls = vi.mocked(execFile).mock.calls.map((c) => (c[1] as string[]).join(" "));
    expect(calls.slice(0, 2)).toEqual(["prisma format", "prisma validate"]);
  });

  test("skips migrations when runMigrations is false", async () => {
    const result = await run({ packageName: "react", currentValue: "^18.0.0", newVersion: "19.0.0", runMigrations: false });
    expect(result.schemaMigrated).toBe(false);
    expect(vi.mocked(execFile).mock.calls).toHaveLength(1);
  });

  test("tolerates a failing migration step, logging its output tail", async () => {
    mockExec((_c, args) => (args.includes("prisma") && args.includes("validate")
      ? { err: new Error("boom"), out: "a\n\nb\n", errOut: "c" }
      : { err: null }));
    const result = await run({ packageName: "prisma", currentValue: "^5.0.0", newVersion: "6.0.0" });
    expect(result).toEqual({ updatedVersion: "^6.0.0", schemaMigrated: false });
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("a\nb\nc"));
  });

  test("tolerates a failing migration step with no output", async () => {
    mockExec((_c, args) => (args.includes("--yes") ? { err: new Error("x") } : { err: null }));
    const result = await run({ packageName: "tailwindcss", currentValue: "^3.0.0", newVersion: "4.0.0" });
    expect(result.schemaMigrated).toBe(false);
  });

  test("returns the current value when the build fails with output", async () => {
    mockExec(() => ({ err: new Error("fail"), out: "error line", errOut: "" }));
    const result = await run();
    expect(result).toEqual({ updatedVersion: "^1.0.0", schemaMigrated: false });
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("error line"));
  });

  test("returns the current value when the build fails without output", async () => {
    mockExec(() => ({ err: new Error("fail") }));
    const result = await run();
    expect(result.updatedVersion).toBe("^1.0.0");
  });

  describe("on win32", () => {
    const original = Object.getOwnPropertyDescriptor(process, "platform");
    beforeEach(() => {
      Object.defineProperty(process, "platform", { value: "win32" });
    });
    afterEach(() => {
      if (original) Object.defineProperty(process, "platform", original);
    });

    test("launches the .cmd shim through a shell", async () => {
      await run();
      const call = vi.mocked(execFile).mock.calls[0];
      expect(call?.[0]).toBe("npm.cmd");
      expect(call?.[2]).toMatchObject({ shell: true });
    });
  });
});
