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
import { DeadCodeGuard } from "../rules/dead-code-guard.js";

export interface GuardConfig {
  projectRoot?: string;
  asyncTargetPath?: string;
  configProjectRoot?: string;
  dependencyTargetPath?: string;
  dockerProjectRoot?: string;
  memoryOptions?: Record<string, unknown>;
  securityTargetUrl?: string | undefined;
  imageTargetPath?: string;
  deadCodeTargetPath?: string;
  networkTargetUrl?: string;
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
  createMemoryGuard(options?: Record<string, unknown>): MemoryGuard {
    return new MemoryGuard(options as unknown as MemoryAuditOptions, this.context);
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
    ];
  }
}
