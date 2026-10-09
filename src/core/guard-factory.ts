/**
 * GuardFactory - Centralized factory for creating and managing audit guards
 * Provides a unified interface to instantiate all guards with consistent AuditContext
 */

import type { AuditContext, AuditResult } from "./types.js";
import { AsyncGuard } from "./async-guard.js";
import { CompatibilityGuard } from "./compatibility-guard.js";
import { ConfigGuard } from "./config-guard.js";
import { DependencyGuard } from "./dependency-guard.js";
import { DockerGuard } from "./docker-guard.js";
import { MemoryGuard, type MemoryAuditOptions } from "./memory-guard.js";
import { SecurityGuard } from "./security-guard.js";
import { ImageGuard } from "./performance/image-guard.js";
import { DeadCodeGuard } from "../rules/dead-code-guard.js";

export interface GuardConfig {
  projectRoot?: string;
  asyncTargetPath?: string;
  configProjectRoot?: string;
  dependencyTargetPath?: string;
  dockerProjectRoot?: string;
  memoryOptions?: Record<string, unknown>;
  securityTargetUrl?: string;
  imageTargetPath?: string;
  deadCodeTargetPath?: string;
}

export class GuardFactory {
  private context: AuditContext;

  constructor(context: AuditContext) {
    this.context = context;
  }

  static create(context: AuditContext): GuardFactory {
    return new GuardFactory(context);
  }

  createAsyncGuard(targetPath: string) {
    return new AsyncGuard({ targetPath }, this.context);
  }

  createCompatibilityGuard(projectRoot?: string) {
    return new CompatibilityGuard(projectRoot, this.context);
  }

  createConfigGuard(projectRoot?: string) {
    return new ConfigGuard({ projectRoot }, this.context);
  }

  createDependencyGuard(targetPath: string) {
    return new DependencyGuard({ targetPath }, this.context);
  }

  createDockerGuard(projectRoot?: string) {
    return new DockerGuard({ projectRoot }, this.context);
  }

  createMemoryGuard(options?: Record<string, unknown>) {
    return new MemoryGuard(options as unknown as MemoryAuditOptions, this.context);
  }

  createSecurityGuard(targetUrl: string) {
    return new SecurityGuard({ targetUrl }, this.context);
  }

  createImageGuard(targetPath?: string) {
    return new ImageGuard(targetPath, this.context);
  }

  createDeadCodeGuard(targetPath: string) {
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
  createAllGuards(config: GuardConfig) {
    return [
      this.createMemoryGuard(config.memoryOptions),
      this.createCompatibilityGuard(config.projectRoot),
      ...(config.asyncTargetPath ? [this.createAsyncGuard(config.asyncTargetPath)] : []),
      ...(config.configProjectRoot ? [this.createConfigGuard(config.configProjectRoot)] : []),
      ...(config.dependencyTargetPath ? [this.createDependencyGuard(config.dependencyTargetPath)] : []),
      ...(config.dockerProjectRoot ? [this.createDockerGuard(config.dockerProjectRoot)] : []),
      ...(config.securityTargetUrl ? [this.createSecurityGuard(config.securityTargetUrl)] : []),
      ...(config.imageTargetPath ? [this.createImageGuard(config.imageTargetPath)] : []),
      ...(config.deadCodeTargetPath ? [this.createDeadCodeGuard(config.deadCodeTargetPath)] : []),
    ];
  }
}
