import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

vi.mock("../../../src/core/performance/http-probe.js", () => ({ probeHttp: vi.fn() }));
vi.mock("../../../src/core/performance/auditor.js", () => ({ runPerformanceAudit: vi.fn() }));

import { probeHttp } from "../../../src/core/performance/http-probe.js";
import { runPerformanceAudit } from "../../../src/core/performance/auditor.js";
import { BundleBudgetGuard } from "../../../src/rules/bundle-budget-guard.js";
import { RenderBlockingGuard } from "../../../src/core/performance/render-blocking-guard.js";
import { HttpOptimizerGuard } from "../../../src/core/performance/http-optimizer-guard.js";
import { CachePerformanceGuard } from "../../../src/core/performance/cache-performance-guard.js";
import { EnvGuard } from "../../../src/core/env-guard.js";
import { GuardFactory } from "../../../src/core/guard-factory.js";
import { BaseGuard, SKIPPED_ISSUE_CODE } from "../../../src/core/base-guard.js";
import type { AuditContext } from "../../../src/core/types.js";

const context: AuditContext = {
  projectRoot: "/tmp",
  timestamp: 1,
  environment: "development",
  nodeVersion: "v",
  npmVersion: "1",
};

describe("workflow guards", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "muraqib-wfg-"));
    vi.mocked(probeHttp).mockReset();
    vi.mocked(runPerformanceAudit).mockReset();
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  describe("BundleBudgetGuard", () => {
    it("extends BaseGuard and reports an oversized source file", async () => {
      fs.writeFileSync(path.join(dir, "big.ts"), "a".repeat(20 * 1024));
      const guard = new BundleBudgetGuard(dir, context);
      expect(guard).toBeInstanceOf(BaseGuard);
      const result = await guard.run();
      expect(result.status).toBe("warning");
      expect(result.issues[0]).toMatchObject({ code: "BUNDLE_BUDGET_EXCEEDED", module: "bundle-budget-guard" });
      expect(result.issues[0]?.message).toContain("big.ts");
    });

    it("passes when every file is within the budget", async () => {
      fs.writeFileSync(path.join(dir, "small.ts"), "export const a = 1;");
      expect((await new BundleBudgetGuard(dir).run()).status).toBe("ok");
    });

    it("reports a project with no source files as skipped, not as a pass", async () => {
      const result = await new BundleBudgetGuard(dir).run();
      expect(result.status).toBe("ok");
      expect(result.issues.map((i) => i.code)).toEqual([SKIPPED_ISSUE_CODE]);
    });
  });

  describe("RenderBlockingGuard", () => {
    it("skips when there is no index.html", async () => {
      const result = await new RenderBlockingGuard(dir).run();
      expect(result.issues.map((i) => i.code)).toEqual([SKIPPED_ISSUE_CODE]);
    });

    it("flags a synchronous script as an error and a stylesheet as a warning, with their line", async () => {
      fs.writeFileSync(
        path.join(dir, "index.html"),
        `<html>\n<head>\n<script src="a.js"></script>\n<link rel="stylesheet" href="a.css">\n</head></html>`
      );
      const result = await new RenderBlockingGuard(dir).run();
      expect(result.status).toBe("issues");
      expect(result.issues.map((i) => [i.code, i.severity, i.location?.line])).toEqual([
        ["RENDER_BLOCKING_SCRIPT", "error", 3],
        ["RENDER_BLOCKING_STYLESHEET", "warning", 4],
      ]);
    });

    it("passes for deferred scripts", async () => {
      fs.writeFileSync(path.join(dir, "index.html"), `<head><script defer src="a.js"></script></head>`);
      const result = await new RenderBlockingGuard(dir).run();
      expect(result.status).toBe("ok");
      expect(result.issues).toEqual([]);
    });
  });

  describe("HttpOptimizerGuard", () => {
    it("reports an unreachable url as an error", async () => {
      vi.mocked(probeHttp).mockResolvedValue({ reachable: false, error: "ECONNREFUSED" } as never);
      const result = await new HttpOptimizerGuard(dir, "http://x").run();
      expect(result.status).toBe("issues");
      expect(result.issues[0]?.message).toContain("ECONNREFUSED");
    });

    it("passes for HTTP/2 with small cookies", async () => {
      vi.mocked(probeHttp).mockResolvedValue({ reachable: true, protocol: "HTTP/2", cookiesSizeBytes: 10 } as never);
      expect((await new HttpOptimizerGuard(dir, "http://x").run()).status).toBe("ok");
    });

    it("warns about HTTP/1.x and large cookies", async () => {
      vi.mocked(probeHttp).mockResolvedValue({ reachable: true, protocol: "http/1.1", cookiesSizeBytes: 99999 } as never);
      const result = await new HttpOptimizerGuard(dir, "http://x").run();
      expect(result.status).toBe("warning");
      expect(result.issues).toHaveLength(2);
    });

    it("turns a probe exception into an error result", async () => {
      vi.mocked(probeHttp).mockRejectedValue(new Error("probe failed"));
      const result = await new HttpOptimizerGuard(dir, "http://x").run();
      expect(result.status).toBe("error");
      expect(result.message).toBe("probe failed");
    });
  });

  describe("CachePerformanceGuard", () => {
    it("lists the cache reports as warnings", async () => {
      vi.mocked(runPerformanceAudit).mockReturnValue({ isOptimized: false, reports: ["cold", "no gzip"] });
      const result = await new CachePerformanceGuard().run();
      expect(result.status).toBe("warning");
      expect(result.issues.map((i) => i.message)).toEqual(["cold", "no gzip"]);
    });

    it("passes when optimized", async () => {
      vi.mocked(runPerformanceAudit).mockReturnValue({ isOptimized: true, reports: [] });
      expect((await new CachePerformanceGuard().run()).status).toBe("ok");
    });
  });

  describe("EnvGuard", () => {
    it("reports violations as errors in safe and non-safe mode", async () => {
      vi.stubEnv("PORT", "abc");
      for (const safe of [true, false]) {
        const result = await new EnvGuard({ safe }).run();
        expect(result.status).toBe("issues");
        expect(result.issues[0]).toMatchObject({ code: "ENV_INVALID", severity: "error", module: "env-guard" });
      }
    });
  });

  describe("GuardFactory", () => {
    const factory = GuardFactory.create(context);
    const names = (config: Parameters<GuardFactory["createAllGuards"]>[0]): string[] =>
      factory.createAllGuards(config).map((g) => g.getModule());

    it("creates the new guards only when their setting is given", () => {
      const defaults = names({});
      for (const optIn of ["bundle-budget", "render-blocking", "http-optimizer", "cache-performance", "env-guard"]) {
        expect(defaults.some((n) => n.includes(optIn))).toBe(false);
      }
      expect(
        names({
          bundleTargetPath: dir,
          renderBlockingTargetPath: dir,
          httpOptimizer: { targetPath: dir, url: "http://x" },
          cachePerformance: true,
          envOptions: {},
        })
      ).toEqual(
        expect.arrayContaining([
          "bundle-budget-guard",
          "render-blocking-guard",
          "http-optimizer-guard",
          "cache-performance-guard",
          "env-guard",
        ])
      );
    });
  });
});
