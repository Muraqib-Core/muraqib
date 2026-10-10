import { beforeEach, describe, expect, test, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

vi.mock("../../../src/core/performance/image-guard.js", () => ({
  runImagePerformanceAudit: vi.fn(),
}));
vi.mock("../../../src/rules/bundle-budget.js", () => ({
  runComprehensiveBundleAudit: vi.fn(),
}));
vi.mock("../../../src/core/performance/network-latency-advisor.js", () => ({
  performLiveLatencyAudit: vi.fn(),
}));
vi.mock("../../../src/core/memory-guard.js", () => ({ performMemoryAudit: vi.fn() }));
vi.mock("../../../src/core/security-guard.js", () => ({ performSecurityAudit: vi.fn() }));
vi.mock("../../../src/rules/dead-code-guard.js", () => ({ performDeadCodeAudit: vi.fn() }));
vi.mock("../../../src/core/dependency-guard.js", () => ({ performDependencyAudit: vi.fn() }));
vi.mock("../../../src/core/async-guard.js", () => ({ performAsyncAudit: vi.fn() }));
vi.mock("../../../src/core/config-guard.js", () => ({ performConfigAudit: vi.fn() }));
vi.mock("../../../src/core/performance/auditor.js", () => ({ runPerformanceAudit: vi.fn() }));
vi.mock("../../../src/core/performance/http-probe.js", () => ({ probeHttp: vi.fn() }));
vi.mock("../../../src/core/upgrade-orchestrator.js", () => ({
  runMuraqibUpgradeOrchestrator: vi.fn(),
}));

import { runImagePerformanceAudit } from "../../../src/core/performance/image-guard.js";
import { runComprehensiveBundleAudit } from "../../../src/rules/bundle-budget.js";
import { performLiveLatencyAudit } from "../../../src/core/performance/network-latency-advisor.js";
import { performMemoryAudit } from "../../../src/core/memory-guard.js";
import { performSecurityAudit } from "../../../src/core/security-guard.js";
import { performDeadCodeAudit } from "../../../src/rules/dead-code-guard.js";
import { performDependencyAudit } from "../../../src/core/dependency-guard.js";
import { performAsyncAudit } from "../../../src/core/async-guard.js";
import { performConfigAudit } from "../../../src/core/config-guard.js";
import { runPerformanceAudit as runPerfCore } from "../../../src/core/performance/auditor.js";
import { probeHttp } from "../../../src/core/performance/http-probe.js";
import { runMuraqibUpgradeOrchestrator } from "../../../src/core/upgrade-orchestrator.js";
import {
  runAsyncAudit,
  runBundleAudit,
  runConfigAudit,
  runDeadCodeAudit,
  runDependencyAudit,
  runEnvAudit,
  runImageAudit,
  runMemoryAudit,
  runNetworkAudit,
  runOptimizerAudit,
  runPerformanceAudit,
  runRenderBlockingAudit,
  runSecurityAudit,
  runUpgradePackages,
} from "../../../src/orchestrator/audit.js";

const boom = (): never => {
  throw new Error("boom");
};

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "muraqib-audit-"));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runImageAudit", () => {
  test("passes when there are no violations", async () => {
    vi.mocked(runImagePerformanceAudit).mockReturnValue({ violations: [] } as never);
    expect(await runImageAudit("/p")).toEqual({ ok: true, errors: [] });
  });

  test("lists oversized images", async () => {
    vi.mocked(runImagePerformanceAudit).mockReturnValue({
      violations: [{ filePath: "a.png", sizeKB: 900 }],
    } as never);
    const result = await runImageAudit("/p");
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain("a.png (900 KB > 500 KB limit)");
  });

  test("converts thrown errors into a failed result", async () => {
    vi.mocked(runImagePerformanceAudit).mockImplementation(boom);
    expect(await runImageAudit("/p")).toEqual({ ok: false, errors: ["boom"] });
  });
});

describe("runBundleAudit", () => {
  test("fails with violations and project issues", async () => {
    vi.mocked(runComprehensiveBundleAudit).mockReturnValue({
      violations: [{ filePath: "main.js", sizeKB: 30, limitKB: 14 }],
      projectIssues: ["no minify"],
      skipped: false,
    } as never);
    const result = await runBundleAudit("/p");
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(["main.js (30 KB > 14 KB budget)", "no minify"]);
  });

  test("returns skipped when nothing was measured", async () => {
    vi.mocked(runComprehensiveBundleAudit).mockReturnValue({
      violations: [],
      projectIssues: [],
      skipped: true,
    } as never);
    expect(await runBundleAudit("/p")).toEqual({ ok: true, errors: [], skipped: true });
  });

  test("passes when within budget", async () => {
    vi.mocked(runComprehensiveBundleAudit).mockReturnValue({
      violations: [],
      projectIssues: [],
      skipped: false,
    } as never);
    expect(await runBundleAudit("/p")).toEqual({ ok: true, errors: [] });
  });

  test("converts thrown errors into a failed result", async () => {
    vi.mocked(runComprehensiveBundleAudit).mockImplementation(boom);
    expect((await runBundleAudit("/p")).errors).toEqual(["boom"]);
  });
});

describe("runNetworkAudit", () => {
  test("passes when optimized", async () => {
    vi.mocked(performLiveLatencyAudit).mockResolvedValue({ isOptimized: true, reports: [] } as never);
    expect((await runNetworkAudit("http://x")).ok).toBe(true);
  });

  test("returns the reports when not optimized", async () => {
    vi.mocked(performLiveLatencyAudit).mockResolvedValue({
      isOptimized: false,
      reports: ["slow"],
    } as never);
    expect(await runNetworkAudit("http://x")).toEqual({ ok: false, errors: ["slow"] });
  });

  test("reports thrown errors", async () => {
    vi.mocked(performLiveLatencyAudit).mockRejectedValue(new Error("offline"));
    expect((await runNetworkAudit("http://x")).errors).toEqual(["offline"]);
  });
});

describe("runMemoryAudit", () => {
  test("passes when optimized", async () => {
    vi.mocked(performMemoryAudit).mockReturnValue({ isOptimized: true, reports: [] } as never);
    expect((await runMemoryAudit()).ok).toBe(true);
  });

  test("returns reports when not optimized", async () => {
    vi.mocked(performMemoryAudit).mockReturnValue({ isOptimized: false, reports: ["leak"] } as never);
    expect((await runMemoryAudit()).errors).toEqual(["leak"]);
  });

  test("reports thrown errors", async () => {
    vi.mocked(performMemoryAudit).mockImplementation(boom);
    expect((await runMemoryAudit()).errors).toEqual(["boom"]);
  });
});

describe("runSecurityAudit", () => {
  test("returns the score when secure", async () => {
    vi.mocked(performSecurityAudit).mockResolvedValue({
      isSecure: true,
      score: 90,
      reports: [],
    } as never);
    expect(await runSecurityAudit("http://x")).toEqual({ ok: true, errors: [], score: 90 });
  });

  test("returns the score and reports when insecure", async () => {
    vi.mocked(performSecurityAudit).mockResolvedValue({
      isSecure: false,
      score: 30,
      reports: ["no hsts"],
    } as never);
    expect(await runSecurityAudit("http://x")).toEqual({
      ok: false,
      errors: ["no hsts"],
      score: 30,
    });
  });

  test("reports thrown errors", async () => {
    vi.mocked(performSecurityAudit).mockRejectedValue(new Error("tls"));
    expect((await runSecurityAudit("http://x")).errors).toEqual(["tls"]);
  });
});

describe.each([
  ["runDeadCodeAudit", runDeadCodeAudit, performDeadCodeAudit],
  ["runDependencyAudit", runDependencyAudit, performDependencyAudit],
  ["runAsyncAudit", runAsyncAudit, performAsyncAudit],
] as const)("%s", (_name, run, core) => {
  test("passes when clean", async () => {
    vi.mocked(core).mockReturnValue({ isClean: true, reports: [] } as never);
    expect(await run("/p")).toEqual({ ok: true, errors: [] });
  });

  test("returns reports when not clean", async () => {
    vi.mocked(core).mockReturnValue({ isClean: false, reports: ["issue"] } as never);
    expect(await run("/p")).toEqual({ ok: false, errors: ["issue"] });
  });

  test("reports thrown errors", async () => {
    vi.mocked(core).mockImplementation(boom);
    expect((await run("/p")).errors).toEqual(["boom"]);
  });
});

describe("runConfigAudit", () => {
  test("passes when healthy", async () => {
    vi.mocked(performConfigAudit).mockReturnValue({ isHealthy: true, reports: [], issues: [] } as never);
    expect((await runConfigAudit("/p")).ok).toBe(true);
  });

  test("prefers reports when present", async () => {
    vi.mocked(performConfigAudit).mockReturnValue({
      isHealthy: false,
      reports: ["r1"],
      issues: [{ message: "m1" }],
    } as never);
    expect((await runConfigAudit("/p")).errors).toEqual(["r1"]);
  });

  test("falls back to issue messages when there are no reports", async () => {
    vi.mocked(performConfigAudit).mockReturnValue({
      isHealthy: false,
      reports: [],
      issues: [{ message: "m1" }],
    } as never);
    expect((await runConfigAudit("/p")).errors).toEqual(["m1"]);
  });

  test("reports thrown errors", async () => {
    vi.mocked(performConfigAudit).mockImplementation(boom);
    expect((await runConfigAudit("/p")).errors).toEqual(["boom"]);
  });
});

describe("runEnvAudit", () => {
  test("returns formatted errors in safe mode for an invalid DATABASE_URL", async () => {
    vi.stubEnv("DATABASE_URL", "not-a-url");
    const result = await runEnvAudit("/p", { safe: true });
    vi.unstubAllEnvs();
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain("DATABASE_URL");
  });

  test("extracts validation errors in non-safe mode", async () => {
    vi.stubEnv("PORT", "abc");
    const result = await runEnvAudit("/p", {});
    vi.unstubAllEnvs();
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

describe("runPerformanceAudit", () => {
  test("passes when optimized", async () => {
    vi.mocked(runPerfCore).mockReturnValue({ isOptimized: true, reports: [] } as never);
    expect((await runPerformanceAudit()).ok).toBe(true);
  });

  test("returns reports when not optimized", async () => {
    vi.mocked(runPerfCore).mockReturnValue({ isOptimized: false, reports: ["cold"] } as never);
    expect((await runPerformanceAudit()).errors).toEqual(["cold"]);
  });

  test("uses a default message when reports are missing", async () => {
    vi.mocked(runPerfCore).mockReturnValue({ isOptimized: false } as never);
    expect((await runPerformanceAudit()).errors).toEqual(["Performance cache issues detected"]);
  });

  test("passes through non-object results", async () => {
    vi.mocked(runPerfCore).mockReturnValue(undefined as never);
    expect((await runPerformanceAudit()).ok).toBe(true);
  });

  test("reports thrown errors", async () => {
    vi.mocked(runPerfCore).mockImplementation(boom);
    expect((await runPerformanceAudit()).errors).toEqual(["boom"]);
  });
});

describe("runOptimizerAudit", () => {
  test("fails when the url is unreachable", async () => {
    vi.mocked(probeHttp).mockResolvedValue({ reachable: false, error: "ECONNREFUSED" } as never);
    const result = await runOptimizerAudit("/p", "http://x");
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain("ECONNREFUSED");
  });

  test("passes for an http/2 site with small cookies", async () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, "a.js"), "x");
    vi.mocked(probeHttp).mockResolvedValue({
      reachable: true,
      protocol: "HTTP/2",
      cookiesSizeBytes: 10,
    } as never);
    const result = await runOptimizerAudit(dir, "http://x");
    fs.rmSync(dir, { recursive: true, force: true });
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  test("flags http/1.1 sites with many resources", async () => {
    const dir = tmp();
    fs.mkdirSync(path.join(dir, "sub"));
    fs.mkdirSync(path.join(dir, "node_modules"));
    fs.writeFileSync(path.join(dir, "node_modules", "skip.js"), "x");
    for (let i = 0; i < 60; i++) fs.writeFileSync(path.join(dir, "sub", `f${i}.js`), "x");
    vi.mocked(probeHttp).mockResolvedValue({
      reachable: true,
      protocol: "http/1.1",
      cookiesSizeBytes: 100000,
    } as never);
    const result = await runOptimizerAudit(dir, "http://x");
    fs.rmSync(dir, { recursive: true, force: true });
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  test("tolerates an unreadable target directory", async () => {
    vi.mocked(probeHttp).mockResolvedValue({
      reachable: true,
      protocol: "HTTP/2",
      cookiesSizeBytes: 0,
    } as never);
    const result = await runOptimizerAudit("/definitely/missing/dir", "http://x");
    expect(result.ok).toBe(true);
  });

  test("reports thrown errors", async () => {
    vi.mocked(probeHttp).mockRejectedValue(new Error("probe failed"));
    expect((await runOptimizerAudit("/p", "http://x")).errors).toEqual(["probe failed"]);
  });
});

describe("runRenderBlockingAudit", () => {
  const withIndex = (html?: string): string => {
    const dir = tmp();
    if (html !== undefined) fs.writeFileSync(path.join(dir, "index.html"), html);
    return dir;
  };

  test("is skipped when there is no index.html", async () => {
    const dir = withIndex();
    const result = await runRenderBlockingAudit(dir);
    fs.rmSync(dir, { recursive: true, force: true });
    expect(result.skipped).toBe(true);
  });

  test("passes when the document has no <head>", async () => {
    const dir = withIndex("<body>hi</body>");
    const result = await runRenderBlockingAudit(dir);
    fs.rmSync(dir, { recursive: true, force: true });
    expect(result).toEqual({ ok: true, errors: [] });
  });

  test("passes for a head with deferred scripts only", async () => {
    const dir = withIndex(`<head><script defer src="a.js"></script></head>`);
    const result = await runRenderBlockingAudit(dir);
    fs.rmSync(dir, { recursive: true, force: true });
    expect(result.ok).toBe(true);
  });

  test("reports blocking scripts and styles", async () => {
    const dir = withIndex(
      `<head><script src="a.js"></script><link rel="stylesheet" href="a.css"></head>`
    );
    const result = await runRenderBlockingAudit(dir);
    fs.rmSync(dir, { recursive: true, force: true });
    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(2);
  });
});

describe("runUpgradePackages", () => {
  test("throws when package.json is missing", async () => {
    const dir = tmp();
    await expect(runUpgradePackages(dir)).rejects.toThrow("No package.json");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("runs the orchestrator for each string dependency", async () => {
    const dir = tmp();
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({
        dependencies: { a: "^1.0.0" },
        devDependencies: { b: "^2.0.0" },
        peerDependencies: { c: { weird: true } },
      })
    );
    vi.mocked(runMuraqibUpgradeOrchestrator).mockResolvedValueOnce(undefined as never);
    vi.mocked(runMuraqibUpgradeOrchestrator).mockRejectedValueOnce(new Error("fail"));
    await runUpgradePackages(dir);
    fs.rmSync(dir, { recursive: true, force: true });
    expect(runMuraqibUpgradeOrchestrator).toHaveBeenCalledTimes(2);
  });

  test("logs a note when nothing was upgraded", async () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, "package.json"), "{}");
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await runUpgradePackages(dir);
    fs.rmSync(dir, { recursive: true, force: true });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("No packages required upgrading"));
    log.mockRestore();
  });
});
