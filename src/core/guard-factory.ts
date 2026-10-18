/**
 * GuardFactory - Centralized factory for creating and managing audit guards
 * Provides a unified interface to instantiate all guards with consistent AuditContext
 */

import type { AuditContext, AuditResult } from "./types.js";
import type { BaseGuard } from "./base-guard.js";
import { AsyncGuard } from "./async-guard.js";
import { CompatibilityGuard } from "./compatibility-guard.js";
import { ConfigGuard } from "./config-guard.js";
import { DependencyGuard } from "./dependency-guard.js";
import { DockerGuard } from "./docker-guard.js";
import { MemoryGuard, type MemoryAuditOptions } from "./memory-guard.js";
import { SecurityGuard } from "./security-guard.js";
import { NetworkLatencyGuard } from "./performance/network-latency-advisor.js";
import { ImageGuard } from "./performance/image-guard.js";
import { RenderBlockingGuard } from "./performance/render-blocking-guard.js";
import { HttpOptimizerGuard } from "./performance/http-optimizer-guard.js";
import { CachePerformanceGuard } from "./performance/cache-performance-guard.js";
import { EnvGuard, type EnvGuardOptions } from "./env-guard.js";
import { DeadCodeGuard } from "../rules/dead-code-guard.js";
import { BundleBudgetGuard } from "../rules/bundle-budget-guard.js";

export interface GuardConfig {
  projectRoot?: string;
  asyncTargetPath?: string;
  configProjectRoot?: string;
  dependencyTargetPath?: string;
  dockerProjectRoot?: string;
  memoryOptions?: MemoryAuditOptions | Record<string, unknown>;
  securityTargetUrl?: string | undefined;
  imageTargetPath?: string;
  deadCodeTargetPath?: string;
  networkTargetUrl?: string;
  /** Opt-in guards: they are only created when their setting is present. */
  bundleTargetPath?: string;
  renderBlockingTargetPath?: string;
  httpOptimizer?: { targetPath: string; url: string };
  envOptions?: EnvGuardOptions;
  /** Create the cache/compression guard (it reads STATIC_ASSETS_CACHE_MAX_AGE and ENABLE_SERVER_COMPRESSION). */
  cachePerformance?: boolean;
}

const MEMORY_OPTION_KEYS = [
  "heapWarnMb",
  "heapCriticalMb",
  "rssWarnMb",
  "externalWarnMb",
  "heapRatioWarn",
] as const;

/**
 * Narrow an untyped options bag to MemoryAuditOptions, keeping only known finite numeric keys.
 */
function toMemoryOptions(options: MemoryAuditOptions | Record<string, unknown> | undefined): MemoryAuditOptions {
  const out: MemoryAuditOptions = {};
  if (!options) return out;
  const bag: Record<string, unknown> = { ...options };
  for (const key of MEMORY_OPTION_KEYS) {
    const value = bag[key];
    if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
  }
  return out;
}

/**
 * Guard factory class.
 */
export class GuardFactory {
  private context: AuditContext;

  constructor(context: AuditContext) {
    this.context = context;
  }

  /**
   * Create.
   *
   * @param context - Context
   * @returns Create result
   */
  static create(context: AuditContext): GuardFactory {
    return new GuardFactory(context);
  }

  /**
   * Create async guard.
   *
   * @param targetPath - Target path
   * @returns Create async guard result
   */
  createAsyncGuard(targetPath: string): AsyncGuard {
    return new AsyncGuard({ targetPath }, this.context);
  }

  /**
   * Create compatibility guard.
   *
   * @param projectRoot - Project root
   * @returns Create compatibility guard result
   */
  createCompatibilityGuard(projectRoot?: string): CompatibilityGuard {
    return new CompatibilityGuard(projectRoot, this.context);
  }

  /**
   * Create config guard.
   *
   * @param projectRoot - Project root
   * @returns Create config guard result
   */
  createConfigGuard(projectRoot?: string): ConfigGuard {
    return new ConfigGuard({ projectRoot }, this.context);
  }

  /**
   * Create dependency guard.
   *
   * @param targetPath - Target path
   * @returns Create dependency guard result
   */
  createDependencyGuard(targetPath: string): DependencyGuard {
    return new DependencyGuard({ targetPath }, this.context);
  }

  /**
   * Create docker guard.
   *
   * @param projectRoot - Project root
   * @returns Create docker guard result
   */
  createDockerGuard(projectRoot?: string): DockerGuard {
    return new DockerGuard({ projectRoot }, this.context);
  }

  /**
   * Create memory guard.
   *
   * @param options - Options
   * @returns Create memory guard result
   */
  createMemoryGuard(options?: MemoryAuditOptions | Record<string, unknown>): MemoryGuard {
    return new MemoryGuard(toMemoryOptions(options), this.context);
  }

  /**
   * Create security guard.
   *
   * @param targetUrl - Target url
   * @returns Create security guard result
   */
  createSecurityGuard(targetUrl: string): SecurityGuard {
    return new SecurityGuard({ targetUrl }, this.context);
  }

  /**
   * Create network latency guard.
   *
   * @param targetUrl - Target url
   * @returns Create network latency guard result
   */
  createNetworkLatencyGuard(targetUrl: string): NetworkLatencyGuard {
    return new NetworkLatencyGuard({ targetUrl }, this.context);
  }

  /**
   * Create image guard.
   *
   * @param targetPath - Target path
   * @returns Create image guard result
   */
  createImageGuard(targetPath?: string): ImageGuard {
    return new ImageGuard(targetPath, this.context);
  }

  /**
   * Create dead code guard.
   *
   * @param targetPath - Target path
   * @returns Create dead code guard result
   */
  createDeadCodeGuard(targetPath: string): DeadCodeGuard {
    return new DeadCodeGuard(targetPath, this.context);
  }

  /**
   * Create bundle budget guard.
   *
   * @param targetPath - Project root whose source files are measured
   * @returns A guard checking each source file against the 14 KB budget
   */
  createBundleBudgetGuard(targetPath: string): BundleBudgetGuard {
    return new BundleBudgetGuard(targetPath, this.context);
  }

  /**
   * Create render blocking guard.
   *
   * @param targetPath - Project root holding index.html
   * @returns A guard checking the head of index.html for render-blocking resources
   */
  createRenderBlockingGuard(targetPath: string): RenderBlockingGuard {
    return new RenderBlockingGuard(targetPath, this.context);
  }

  /**
   * Create HTTP optimizer guard.
   *
   * @param targetPath - Project root whose static resources are counted
   * @param url - Live URL to probe
   * @returns A guard checking the URL's protocol and cookie size
   */
  createHttpOptimizerGuard(targetPath: string, url: string): HttpOptimizerGuard {
    return new HttpOptimizerGuard(targetPath, url, this.context);
  }

  /**
   * Create cache performance guard.
   *
   * @returns A guard checking the cache and compression environment settings
   */
  createCachePerformanceGuard(): CachePerformanceGuard {
    return new CachePerformanceGuard(this.context);
  }

  /**
   * Create env guard.
   *
   * @param options - Presets, schedule and safe mode
   * @returns A guard validating the process environment
   */
  createEnvGuard(options?: EnvGuardOptions): EnvGuard {
    return new EnvGuard(options, this.context);
  }

  /**
   * Run all guards in parallel and collect results
   */
  async runAllGuards(config: GuardConfig): Promise<AuditResult[]> {
    const guards = this.createAllGuards(config);
    return Promise.all(guards.map((guard) => guard.run()));
  }

  /**
   * Create all available guards without running them
   */
  createAllGuards(config: GuardConfig): BaseGuard[] {
    return [
      this.createMemoryGuard(config.memoryOptions),
      this.createCompatibilityGuard(config.projectRoot),
      ...(config.asyncTargetPath ? [this.createAsyncGuard(config.asyncTargetPath)] : []),
      ...(config.configProjectRoot ? [this.createConfigGuard(config.configProjectRoot)] : []),
      ...(config.dependencyTargetPath ? [this.createDependencyGuard(config.dependencyTargetPath)] : []),
      ...(config.dockerProjectRoot ? [this.createDockerGuard(config.dockerProjectRoot)] : []),
      ...(config.securityTargetUrl ? [this.createSecurityGuard(config.securityTargetUrl)] : []),
      ...(config.networkTargetUrl ? [this.createNetworkLatencyGuard(config.networkTargetUrl)] : []),
      ...(config.imageTargetPath ? [this.createImageGuard(config.imageTargetPath)] : []),
      ...(config.deadCodeTargetPath ? [this.createDeadCodeGuard(config.deadCodeTargetPath)] : []),
      ...(config.bundleTargetPath ? [this.createBundleBudgetGuard(config.bundleTargetPath)] : []),
      ...(config.renderBlockingTargetPath ? [this.createRenderBlockingGuard(config.renderBlockingTargetPath)] : []),
      ...(config.httpOptimizer ? [this.createHttpOptimizerGuard(config.httpOptimizer.targetPath, config.httpOptimizer.url)] : []),
      ...(config.cachePerformance ? [this.createCachePerformanceGuard()] : []),
      ...(config.envOptions ? [this.createEnvGuard(config.envOptions)] : []),
    ];
  }
}
