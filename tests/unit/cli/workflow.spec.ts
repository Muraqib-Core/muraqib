import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { ModuleResult } from "../../../src/orchestrator/audit.js";

const ok = (): ModuleResult => ({ ok: true, errors: [] });
const bad = (...errors: string[]): ModuleResult => ({ ok: false, errors });

vi.mock("../../../src/orchestrator/audit.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/orchestrator/audit.js")>();
  return {
    ...actual,
    runImageAudit: vi.fn(),
    runBundleAudit: vi.fn(),
    runNetworkAudit: vi.fn(),
    runMemoryAudit: vi.fn(),
    runSecurityAudit: vi.fn(),
    runDeadCodeAudit: vi.fn(),
    runDependencyAudit: vi.fn(),
    runAsyncAudit: vi.fn(),
    runConfigAudit: vi.fn(),
    runEnvAudit: vi.fn(),
    runPerformanceAudit: vi.fn(),
    runOptimizerAudit: vi.fn(),
    runRenderBlockingAudit: vi.fn(),
    runUpgradePackages: vi.fn(),
  };
});

import * as audit from "../../../src/orchestrator/audit.js";
import { runAuditWorkflow } from "../../../src/cli/workflow.js";

const mocked = vi.mocked(audit);

function allPass(): void {
  mocked.runImageAudit.mockResolvedValue(ok());
  mocked.runBundleAudit.mockResolvedValue(ok());
  mocked.runNetworkAudit.mockResolvedValue(ok());
  mocked.runMemoryAudit.mockResolvedValue(ok());
  mocked.runSecurityAudit.mockResolvedValue({ ...ok(), score: 95 });
  mocked.runDeadCodeAudit.mockResolvedValue(ok());
  mocked.runDependencyAudit.mockResolvedValue(ok());
  mocked.runAsyncAudit.mockResolvedValue(ok());
  mocked.runConfigAudit.mockResolvedValue(ok());
  mocked.runEnvAudit.mockResolvedValue(ok());
  mocked.runPerformanceAudit.mockResolvedValue(ok());
  mocked.runOptimizerAudit.mockResolvedValue(ok());
  mocked.runRenderBlockingAudit.mockResolvedValue(ok());
  mocked.runUpgradePackages.mockResolvedValue(undefined as never);
}

describe("runAuditWorkflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    allPass();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("runs every module and returns a passing result", async () => {
    const result = await runAuditWorkflow({ targetPath: "/p", silent: true });
    expect(result.env.ok).toBe(true);
    expect(mocked.runImageAudit).toHaveBeenCalledWith("/p");
    expect(mocked.runNetworkAudit).toHaveBeenCalledWith("http://localhost:3000");
    expect(mocked.runSecurityAudit).toHaveBeenCalledWith("http://localhost:3000");
    expect(mocked.runOptimizerAudit).toHaveBeenCalledWith("/p", "http://localhost:3000");
    expect(result.security.score).toBe(95);
  });

  test("uses the supplied latency and security urls", async () => {
    await runAuditWorkflow({
      targetPath: "/p",
      latencyUrl: "http://a",
      securityUrl: "http://b",
      silent: true,
    });
    expect(mocked.runNetworkAudit).toHaveBeenCalledWith("http://a");
    expect(mocked.runSecurityAudit).toHaveBeenCalledWith("http://b");
  });

  test("does not call skipped modules and marks them skipped", async () => {
    const result = await runAuditWorkflow({
      targetPath: "/p",
      silent: true,
      skipNetwork: true,
      skipMemory: true,
      skipSecurity: true,
      skipDeadCode: true,
      skipDependencies: true,
      skipAsync: true,
      skipConfig: true,
      skipEnv: true,
      skipPerformance: true,
      skipOptimizer: true,
      skipRenderBlocking: true,
    });
    expect(mocked.runNetworkAudit).not.toHaveBeenCalled();
    expect(mocked.runMemoryAudit).not.toHaveBeenCalled();
    expect(mocked.runSecurityAudit).not.toHaveBeenCalled();
    expect(mocked.runEnvAudit).not.toHaveBeenCalled();
    expect(result.network.skipped).toBe(true);
    expect(result.optimizer.skipped).toBe(true);
    expect(result.security.score).toBeUndefined();
  });

  test("skipping the network also skips the optimizer", async () => {
    const result = await runAuditWorkflow({ targetPath: "/p", silent: true, skipNetwork: true });
    expect(mocked.runOptimizerAudit).not.toHaveBeenCalled();
    expect(result.optimizer.skipped).toBe(true);
  });

  test("passes env options through to the env audit", async () => {
    await runAuditWorkflow({
      targetPath: "/p",
      silent: true,
      presets: ["postgres"],
      schedule: "daily",
      safe: true,
    });
    expect(mocked.runEnvAudit).toHaveBeenCalledWith("/p", {
      presets: ["postgres"],
      schedule: "daily",
      safe: true,
    });
  });

  test("passes empty env options when none are given", async () => {
    await runAuditWorkflow({ targetPath: "/p", silent: true });
    expect(mocked.runEnvAudit).toHaveBeenCalledWith("/p", {});
  });

  test("records failures from every module in the result", async () => {
    mocked.runImageAudit.mockResolvedValue(bad("big.png"));
    mocked.runBundleAudit.mockResolvedValue(bad("bundle"));
    mocked.runNetworkAudit.mockResolvedValue(bad("slow"));
    mocked.runMemoryAudit.mockResolvedValue(bad("leak"));
    mocked.runSecurityAudit.mockResolvedValue({ ...bad("no csp"), score: 20 });
    mocked.runDeadCodeAudit.mockResolvedValue(bad("dead"));
    mocked.runDependencyAudit.mockResolvedValue(bad("dep"));
    mocked.runAsyncAudit.mockResolvedValue(bad("async"));
    mocked.runConfigAudit.mockResolvedValue(bad("cfg"));
    mocked.runEnvAudit.mockResolvedValue(bad("env"));
    mocked.runPerformanceAudit.mockResolvedValue(bad("perf"));
    mocked.runOptimizerAudit.mockResolvedValue(bad("opt"));
    mocked.runRenderBlockingAudit.mockResolvedValue(bad("rb"));

    const result = await runAuditWorkflow({ targetPath: "/p", silent: true });
    expect(result.images.errors).toEqual(["big.png"]);
    expect(result.security.score).toBe(20);
    expect(result.renderBlocking.ok).toBe(false);
    const printed = vi.mocked(console.log).mock.calls.map((c) => String(c[0])).join("\n");
    expect(printed).toContain("big.png");
    expect(printed).toContain("no csp");
  });

  test("treats a mid-range security score as a warning, not a failure", async () => {
    mocked.runSecurityAudit.mockResolvedValue({ ...bad("weak"), score: 70 });
    const result = await runAuditWorkflow({ targetPath: "/p", silent: true });
    expect(result.security.score).toBe(70);
  });

  test("handles a skipped bundle audit (no source files)", async () => {
    mocked.runBundleAudit.mockResolvedValue({ ok: true, errors: [], skipped: true });
    const result = await runAuditWorkflow({ targetPath: "/p", silent: true });
    expect(result.bundle.skipped).toBe(true);
  });

  test("runs the upgrade step when requested", async () => {
    await runAuditWorkflow({ targetPath: "/p", silent: true, upgrade: true });
    expect(mocked.runUpgradePackages).toHaveBeenCalledWith("/p");
  });

  test("reports an upgrade failure without throwing", async () => {
    mocked.runUpgradePackages.mockRejectedValue(new Error("rollback"));
    await expect(
      runAuditWorkflow({ targetPath: "/p", silent: true, upgrade: true })
    ).resolves.toBeDefined();
  });

  test("exits with code 0 when everything passes and exitProcess is set", async () => {
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    await runAuditWorkflow({ targetPath: "/p", silent: true, exitProcess: true });
    expect(exit).toHaveBeenCalledWith(0);
  });

  test("exits with code 1 when a blocking module fails and exitProcess is set", async () => {
    mocked.runEnvAudit.mockResolvedValue(bad("env"));
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    await runAuditWorkflow({ targetPath: "/p", silent: true, exitProcess: true });
    expect(exit).toHaveBeenCalledWith(1);
  });

  test("defaults the target path to the current directory", async () => {
    await runAuditWorkflow({ silent: true });
    expect(mocked.runImageAudit).toHaveBeenCalledWith(process.cwd());
  });
});
