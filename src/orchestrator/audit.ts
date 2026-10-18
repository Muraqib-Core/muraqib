import fs from "fs";
import path from "path";
import { z } from "zod";
import { runImagePerformanceAudit } from "../core/performance/image-guard.js";
import { runComprehensiveBundleAudit } from "../rules/bundle-budget.js";
import { performLiveLatencyAudit } from "../core/performance/network-latency-advisor.js";
import { performMemoryAudit } from "../core/memory-guard.js";
import { performSecurityAudit } from "../core/security-guard.js";
import { performDeadCodeAudit } from "../rules/dead-code-guard.js";
import { performDependencyAudit } from "../core/dependency-guard.js";
import { performAsyncAudit } from "../core/async-guard.js";
import { performConfigAudit } from "../core/config-guard.js";
import { runPerformanceAudit as runPerformanceAuditCore } from "../core/performance/auditor.js";
import { performRenderBlockingAudit } from "../core/performance/render-blocking.js";
import { analyzeHttpProfile } from "../core/performance/optimizer-engine.js";
import { probeHttp } from "../core/performance/http-probe.js";
import { cachePerformanceSchema } from "../rules/cache-guard.js";
import { createEnvWithPresets, safeCreateEnv } from "../env/index.js";
import { runMuraqibUpgradeOrchestrator } from "../core/upgrade-orchestrator.js";
import { toMessage, extractEnvErrors } from "../shared/utils.js";
import * as logger from "../shared/logger.js";

/**
 * Options for comprehensive project audit
 * @interface AuditOptions
 */
export interface AuditOptions {
  targetPath?: string | undefined;
  latencyUrl?: string | undefined;
  securityUrl?: string | undefined;
  skipEnv?: boolean | undefined;
  skipNetwork?: boolean | undefined;
  skipMemory?: boolean | undefined;
  skipSecurity?: boolean | undefined;
  skipDeadCode?: boolean | undefined;
  skipDependencies?: boolean | undefined;
  skipAsync?: boolean | undefined;
  skipConfig?: boolean | undefined;
  skipPerformance?: boolean | undefined;
  skipOptimizer?: boolean | undefined;
  skipRenderBlocking?: boolean | undefined;
  silent?: boolean | undefined;
  schedule?: string | undefined;
  presets?: string[] | undefined;
  safe?: boolean | undefined;
  upgrade?: boolean | undefined;
  exitProcess?: boolean | undefined;
}

/**
 * Result of a single audit module
 * @interface ModuleResult
 */
export interface ModuleResult {
  ok: boolean;
  errors: string[];
  skipped?: boolean | undefined;
}

/**
 * Aggregated result from all 13 audit modules
 * @interface AuditResult
 */
export interface AuditResult {
  env: ModuleResult;
  images: ModuleResult;
  bundle: ModuleResult;
  network: ModuleResult;
  memory: ModuleResult;
  security: ModuleResult & { score?: number | undefined };
  deadCode: ModuleResult;
  dependencies: ModuleResult;
  async: ModuleResult;
  config: ModuleResult;
  performance: ModuleResult;
  optimizer: ModuleResult;
  renderBlocking: ModuleResult;
}

/**
 * Creates a fresh audit result with all modules initialized to ok=true
 * @returns AuditResult with clean state across all 13 modules
 */
export function createInitialAuditResult(): AuditResult {
  return {
    env: { ok: true, errors: [] },
    images: { ok: true, errors: [] },
    bundle: { ok: true, errors: [] },
    network: { ok: true, errors: [] },
    memory: { ok: true, errors: [] },
    security: { ok: true, errors: [], score: 100 },
    deadCode: { ok: true, errors: [] },
    dependencies: { ok: true, errors: [] },
    async: { ok: true, errors: [] },
    config: { ok: true, errors: [] },
    performance: { ok: true, errors: [] },
    optimizer: { ok: true, errors: [] },
    renderBlocking: { ok: true, errors: [] },
  };
}

/** Runs one audit module, turning a thrown error into a failed result instead of aborting the audit. */
async function guarded(run: () => ModuleResult | Promise<ModuleResult>): Promise<ModuleResult> {
  try {
    return await run();
  } catch (err: unknown) {
    return { ok: false, errors: [toMessage(err)] };
  }
}

/** The common module outcome: clean when the audit says so, otherwise its reports as errors. */
function fromReports(clean: boolean, reports: string[]): ModuleResult {
  return clean ? { ok: true, errors: [] } : { ok: false, errors: reports };
}

/**
 * Audits image assets for size violations (> 500 KB)
 * @param targetPath - Project root directory
 * @returns ModuleResult with violations listed in errors
 */
export async function runImageAudit(targetPath: string): Promise<ModuleResult> {
  try {
    const { violations } = runImagePerformanceAudit(targetPath);
    if (violations.length > 0) {
      return {
        ok: false,
        errors: violations.map((v) => `${v.filePath} (${v.sizeKB} KB > 500 KB limit)`),
      };
    }
    return { ok: true, errors: [] };
  } catch (err: unknown) {
    return { ok: false, errors: [toMessage(err)] };
  }
}

/**
 * Audits bundle size against 14 KB round-trip budget
 * @param targetPath - Project root directory
 * @returns ModuleResult with violations if bundle exceeds budget
 */
export async function runBundleAudit(targetPath: string): Promise<ModuleResult> {
  try {
    const bundle = runComprehensiveBundleAudit(targetPath);
    const bundleErrors = [
      ...bundle.violations.map((v) => `${v.filePath} (${v.sizeKB} KB > ${v.limitKB} KB budget)`),
      ...bundle.projectIssues,
    ];
    if (bundleErrors.length > 0) {
      return { ok: false, errors: bundleErrors };
    }
    if (bundle.skipped) {
      return { ok: true, errors: [], skipped: true };
    }
    return { ok: true, errors: [] };
  } catch (err: unknown) {
    return { ok: false, errors: [toMessage(err)] };
  }
}

/**
 * Audits the first-response latency and size of a live URL.
 *
 * @param latencyUrl - URL to measure
 * @returns Failed with the advisor's reports when the response is not optimized, or when the URL cannot be reached
 */
export async function runNetworkAudit(latencyUrl: string): Promise<ModuleResult> {
  try {
    const net = await performLiveLatencyAudit(latencyUrl);
    if (!net.isOptimized) {
      return { ok: false, errors: net.reports };
    }
    return { ok: true, errors: [] };
  } catch (err: unknown) {
    return { ok: false, errors: [toMessage(err) || "Network request failed"] };
  }
}

/**
 * Audits the V8 heap usage of the current process.
 *
 * @returns Failed with the memory reports when a usage threshold is exceeded
 */
export async function runMemoryAudit(): Promise<ModuleResult> {
  return guarded(() => {
    const result = performMemoryAudit();
    return fromReports(result.isOptimized, result.reports);
  });
}

/**
 * Audits HTTP endpoint for security headers and best practices
 * @param securityUrl - Full URL to audit (http or https)
 * @returns ModuleResult with security score (0-100) and header violations
 */
export async function runSecurityAudit(securityUrl: string): Promise<ModuleResult & { score?: number }> {
  try {
    const sec = await performSecurityAudit(securityUrl);
    if (!sec.isSecure) {
      return { ok: false, errors: sec.reports, score: sec.score };
    }
    return { ok: true, errors: [], score: sec.score };
  } catch (err: unknown) {
    return { ok: false, errors: [toMessage(err)] };
  }
}

/**
 * Audits codebase for empty functions, unreachable code, and unused exports
 * @param targetPath - Project root directory
 * @returns ModuleResult with dead code locations and severity
 */
export async function runDeadCodeAudit(targetPath: string): Promise<ModuleResult> {
  return guarded(() => {
    const result = performDeadCodeAudit(targetPath);
    return fromReports(result.isClean, result.reports);
  });
}

/**
 * Audits source dependencies: deprecated APIs, circular imports and duplicate versions in the lockfile.
 *
 * @param targetPath - Project root directory
 * @returns Failed with the dependency reports when the project is not clean
 */
export async function runDependencyAudit(targetPath: string): Promise<ModuleResult> {
  return guarded(() => {
    const result = performDependencyAudit(targetPath);
    return fromReports(result.isClean, result.reports);
  });
}

/**
 * Audits source files for risky asynchronous operations.
 *
 * @param targetPath - Project root directory
 * @returns Failed with the async reports when the project is not clean
 */
export async function runAsyncAudit(targetPath: string): Promise<ModuleResult> {
  return guarded(() => {
    const result = performAsyncAudit(targetPath);
    return fromReports(result.isClean, result.reports);
  });
}

/**
 * Audits project configuration: tsconfig options and committed environment files.
 *
 * @param targetPath - Project root directory
 * @returns Failed with the configuration findings when the project is not healthy
 */
export async function runConfigAudit(targetPath: string): Promise<ModuleResult> {
  try {
    const cfg = performConfigAudit(targetPath);
    if (!cfg.isHealthy) {
      return { ok: false, errors: cfg.reports.length ? cfg.reports : cfg.issues.map((i) => i.message) };
    }
    return { ok: true, errors: [] };
  } catch (err: unknown) {
    return { ok: false, errors: [toMessage(err)] };
  }
}

/**
 * Audits environment variables and configuration with optional presets
 * @param _targetPath - Project root directory (for consistency with other audits)
 * @param options - Audit options including presets, schedule guard, and safe mode
 * @returns ModuleResult with validation errors if any required vars are missing
 */
export async function runEnvAudit(
  _targetPath: string,
  options: { presets?: string[]; schedule?: string; safe?: boolean }
): Promise<ModuleResult> {
  try {
    const schema = {
      DATABASE_URL: z.string().url().optional(),
      PORT: z
        .string()
        .regex(/^\d+$/, "PORT must be a numeric string")
        .optional()
        .transform((v) => Number(v ?? "3000")),
      ...cachePerformanceSchema,
    };

    const envOptions = {
      server: schema,
      runtimeEnv: process.env as Record<string, string | undefined>,
      isServer: true,
      silent: true,
      ...(options.presets ? { presets: options.presets as import("../env/preset-map.js").PresetInput[] } : {}),
      ...(options.schedule ? { schedule: options.schedule } : {}),
    } as unknown as import("../env/index.js").CreateEnvOptions;

    if (options.safe) {
      const envResult = safeCreateEnv(envOptions);
      if (!envResult.success) {
        return {
          ok: false,
          errors: envResult.error.map((e) => `${e.path}: ${e.message}`),
        };
      }
    } else {
      createEnvWithPresets(schema, envOptions as unknown as Parameters<typeof createEnvWithPresets>[1]);
    }

    return { ok: true, errors: [] };
  } catch (err: unknown) {
    const errors = extractEnvErrors(err);
    return { ok: false, errors };
  }
}

/**
 * Audits the caching and compression settings read from the environment.
 *
 * @returns Failed with the performance reports when the cache setup is not optimized
 */
export async function runPerformanceAudit(): Promise<ModuleResult> {
  try {
    const perf = runPerformanceAuditCore();
    if (typeof perf === "object" && perf !== null && "isOptimized" in perf && !perf.isOptimized) {
      return { ok: false, errors: perf.reports ?? ["Performance cache issues detected"] };
    }
    return { ok: true, errors: [] };
  } catch (err: unknown) {
    return { ok: false, errors: [toMessage(err)] };
  }
}

/**
 * Measures the protocol and cookie size of a live URL against the project's resource count.
 *
 * @param targetPath - Project root directory (its static resources are counted)
 * @param url - URL to probe
 * @returns Failed when the URL is unreachable or the HTTP profile has issues
 */
export async function runOptimizerAudit(targetPath: string, url: string): Promise<ModuleResult> {
  try {
    const probe = await probeHttp(url);
    if (!probe.reachable) {
      return {
        ok: false,
        errors: [`تعذّر قياس البروتوكول والكوكيز: لا يمكن الوصول إلى ${url} (${probe.error})`],
      };
    }

    let resourceCount = 0;
    const countResources = (dir: string): number => {
      let count = 0;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          count += countResources(fullPath);
        } else if (
          entry.isFile() &&
          /\.(js|css|png|jpe?g|svg|gif|webp|ico|html|woff2?)$/i.test(entry.name)
        ) {
          count++;
        }
      }
      return count;
    };

    try {
      resourceCount = countResources(targetPath);
    } catch {
      /* ignore */
    }

    const { issues } = analyzeHttpProfile(resourceCount, probe.protocol, probe.cookiesSizeBytes);

    if (issues.length === 0) {
      return { ok: true, errors: [] };
    }
    return { ok: false, errors: issues };
  } catch (err: unknown) {
    return { ok: false, errors: [toMessage(err)] };
  }
}


/**
 * Audits the root index.html for render-blocking scripts and stylesheets in the head.
 *
 * @param targetPath - Project root directory
 * @returns Skipped when there is no index.html; failed with one error per blocking resource
 */
export async function runRenderBlockingAudit(targetPath: string): Promise<ModuleResult> {
  try {
    let htmlContent = "";
    try {
      const htmlPath = path.join(targetPath, "index.html");
      if (fs.existsSync(htmlPath)) {
        htmlContent = fs.readFileSync(htmlPath, "utf-8");
      }
    } catch {
      /* ignore missing HTML */
    }

    if (!htmlContent) {
      return { ok: true, errors: [], skipped: true };
    }

    const blocking = performRenderBlockingAudit(htmlContent).criticalIssues.filter(
      (issue) => issue.type === "render_blocking_js" || issue.type === "render_blocking_css"
    );
    if (blocking.length === 0) {
      return { ok: true, errors: [] };
    }
    return {
      ok: false,
      errors: blocking.map((issue) => {
        const what = issue.type === "render_blocking_js" ? "Render-blocking script" : "Render-blocking stylesheet";
        return `${what} in <head>: ${issue.resource}. ${issue.suggestion}`;
      }),
    };
  } catch (err: unknown) {
    return { ok: false, errors: [toMessage(err)] };
  }
}

/**
 * Run upgrade packages.
 *
 * @param targetPath - Target path
 */
export async function runUpgradePackages(targetPath: string): Promise<void> {
  const pkgPath = path.join(targetPath, "package.json");
  if (!fs.existsSync(pkgPath)) {
    throw new Error("No package.json found at target path");
  }
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
  const allDeps = {
    ...pkg.dependencies,
    ...pkg.devDependencies,
    ...pkg.peerDependencies,
  };

  let upgraded = 0;
  for (const [name, current] of Object.entries(allDeps)) {
    if (typeof current !== "string") continue;
    try {
      const result = await runMuraqibUpgradeOrchestrator({
        packageName: name,
        currentValue: current,
        newVersion: current,
        rangeStrategy: "replace",
        cwd: targetPath,
      });
      if (result.updatedVersion !== null && result.updatedVersion !== current) {
        upgraded++;
      }
    } catch {
      // Skip failed individual upgrades
    }
  }

  if (upgraded === 0) {
    logger.log("[Muraqib] No packages required upgrading.");
  }
}
