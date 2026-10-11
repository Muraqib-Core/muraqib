import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const h = vi.hoisted(() => ({
  select: vi.fn(),
  note: vi.fn(),
  cancel: vi.fn(),
  isCancel: vi.fn((v: unknown) => v === "__cancel__"),
  spinner: { start: vi.fn(), stop: vi.fn() },
  run: vi.fn(),
  generatePlans: vi.fn(),
  apply: vi.fn(),
}));

vi.mock("@clack/prompts", () => ({
  select: h.select,
  note: h.note,
  cancel: h.cancel,
  isCancel: h.isCancel,
  spinner: () => h.spinner,
}));
vi.mock("../../../src/scan/core/runner/audit-runner.js", () => ({
  AuditRunner: class {
    run = h.run;
  },
}));
vi.mock("../../../src/scan/core/resolution/dependency-graph.js", () => ({
  DependencyGraph: class {
    packageManager = "npm";
  },
}));
vi.mock("../../../src/scan/core/resolution/resolution-engine.js", () => ({
  ResolutionEngine: class {
    generatePlans = h.generatePlans;
  },
}));
vi.mock("../../../src/scan/core/resolution/resolution-applier.js", () => ({
  ResolutionApplier: class {
    apply = h.apply;
  },
}));

import { runResolveWorkflow } from "../../../src/scan/cli/resolve-workflow.js";
import type { ProjectContext } from "../../../src/scan/core/context/project-context.js";

const context = { projectPath: "/tmp/project" } as unknown as ProjectContext;

function makePlan(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    title: `Plan ${id}`,
    planName: `Upgrade lodash (${id})`,
    reason: "advisory",
    changes: [
      { packageName: "lodash", currentVersion: "4.0.0", targetVersion: "4.17.21", direction: "upgrade", reason: "CVE fix" },
    ],
    findingsResolved: [{ dependencyProblem: { advisoryCount: 2 } }],
    securityImpact: "Removes 2 advisories",
    compatibility: "Compatible",
    risk: "Low",
    affectedPackages: ["lodash"],
    ...overrides,
  };
}

describe("runResolveWorkflow", () => {
  let logs: string[];
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    logs = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.join(" "));
    });
    // process.exit must stop the workflow like the real one does.
    exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);
    h.run.mockResolvedValue({ findings: [] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("exits 1 when the dependency scan fails", async () => {
    h.run.mockRejectedValue(new Error("boom"));
    await expect(runResolveWorkflow(context)).rejects.toThrow("exit:1");
    expect(h.spinner.stop).toHaveBeenCalledWith("Failed to scan project dependencies.");
    expect(logs.join("\n")).toContain("boom");
  });

  test("handles non-Error scan failures", async () => {
    h.run.mockRejectedValue("plain");
    await expect(runResolveWorkflow(context)).rejects.toThrow("exit:1");
    expect(logs.join("\n")).toContain("plain");
  });

  test("reports clean dependencies and exits 0 when there are no plans", async () => {
    h.generatePlans.mockReturnValue([]);
    await expect(runResolveWorkflow(context)).rejects.toThrow("exit:0");
    expect(h.note).toHaveBeenCalledWith(expect.stringContaining("No resolvable"), expect.any(String));
  });

  test("cancels without changes when the user dismisses candidate selection", async () => {
    h.generatePlans.mockReturnValue([makePlan("a"), makePlan("b")]);
    h.select.mockResolvedValueOnce("__cancel__");
    await runResolveWorkflow(context);
    expect(h.cancel).toHaveBeenCalledWith(expect.stringContaining("No changes were applied"));
    expect(h.apply).not.toHaveBeenCalled();
  });

  test("cancels when the selected plan no longer exists", async () => {
    h.generatePlans.mockReturnValue([makePlan("a"), makePlan("b")]);
    h.select.mockResolvedValueOnce("missing");
    await runResolveWorkflow(context);
    expect(h.cancel).toHaveBeenCalledWith(expect.stringContaining("no longer available"));
    expect(h.apply).not.toHaveBeenCalled();
  });

  test("does not apply anything when approval is declined", async () => {
    h.generatePlans.mockReturnValue([makePlan("a")]);
    h.select.mockResolvedValueOnce("no");
    await runResolveWorkflow(context);
    expect(h.apply).not.toHaveBeenCalled();
    expect(logs.join("\n")).toContain("No changes were applied");
  });

  test("does not apply anything when approval is cancelled", async () => {
    h.generatePlans.mockReturnValue([makePlan("a")]);
    h.select.mockResolvedValueOnce("__cancel__");
    await runResolveWorkflow(context);
    expect(h.apply).not.toHaveBeenCalled();
  });

  test("lets the user pick among several plans and applies the approved one", async () => {
    const plans = [makePlan("a"), makePlan("b")];
    h.generatePlans.mockReturnValue(plans);
    h.select.mockResolvedValueOnce("b").mockResolvedValueOnce("yes");
    h.apply.mockResolvedValue({
      status: "applied",
      applied: true,
      message: "ok",
      verificationResults: [
        { step: "build", passed: true, status: "passed", message: "fine" },
        { step: "tests", passed: false },
      ],
    });
    await runResolveWorkflow(context);
    expect(h.apply).toHaveBeenCalledWith(plans[1], "approved");
    const out = logs.join("\n");
    expect(out).toContain("Build: passed");
    expect(out).toContain("Tests: unknown");
    expect(out).toContain("Resolution completed successfully");
  });

  test("reports a stale plan", async () => {
    h.generatePlans.mockReturnValue([makePlan("a")]);
    h.select.mockResolvedValueOnce("yes");
    h.apply.mockResolvedValue({ status: "stale", applied: false, message: "project changed" });
    await runResolveWorkflow(context);
    expect(logs.join("\n")).toContain("project changed");
  });

  test("reports a failed apply", async () => {
    h.generatePlans.mockReturnValue([makePlan("a")]);
    h.select.mockResolvedValueOnce("yes");
    h.apply.mockResolvedValue({ status: "failed", applied: false, message: "install failed" });
    await runResolveWorkflow(context);
    expect(logs.join("\n")).toContain("Failed to apply resolution: install failed");
  });

  test("prints the applier message when the status is not 'applied'", async () => {
    h.generatePlans.mockReturnValue([makePlan("a")]);
    h.select.mockResolvedValueOnce("yes");
    h.apply.mockResolvedValue({ status: "rolled-back", applied: true, message: "rolled back after failure" });
    await runResolveWorkflow(context);
    const out = logs.join("\n");
    expect(out).toContain("rolled back after failure");
    expect(out).not.toContain("Resolution completed successfully");
  });

  test("renders limitations, incompatibility and a singular advisory", async () => {
    h.generatePlans.mockReturnValue([
      makePlan("a", {
        compatibility: "Incompatible",
        limitations: ["Peer range unverified"],
        findingsResolved: [],
        changes: [{ packageName: "x", currentVersion: "1.0.0", targetVersion: "2.0.0", direction: "upgrade" }],
      }),
    ]);
    h.select.mockResolvedValueOnce("no");
    await runResolveWorkflow(context);
    const out = logs.join("\n");
    expect(out).toContain("Limitations:");
    expect(out).toContain("Peer range unverified");
    expect(out).toContain("✗ Incompatible");
    expect(out).toContain("1 known security advisory.");
    expect(out).not.toContain("Reason:");
  });

  test("never touches process.exit on the happy path", async () => {
    h.generatePlans.mockReturnValue([makePlan("a")]);
    h.select.mockResolvedValueOnce("no");
    await runResolveWorkflow(context);
    expect(exitSpy).not.toHaveBeenCalled();
  });
});
