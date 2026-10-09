/**
 * Resolution Applier Module
 * Applies resolution changes and suggests modifications to package.json
 */

import { BaseGuard } from '../base-guard.js';
import type { AuditResult, AuditIssue, AuditContext } from '../types.js';
import type { DependencyGraph } from './dependency-graph.js';
import type { ResolutionPlan, FixStep } from './resolution-plan.js';

export interface PackageJsonModification {
  field: 'dependencies' | 'devDependencies' | 'peerDependencies' | 'optionalDependencies';
  packageName: string;
  oldVersion: string;
  newVersion: string;
  reason: string;
}

export interface ApplierOptions {
  dryRun?: boolean;
  autoApply?: boolean;
  packageJsonPath?: string;
}

export interface ApplyResult {
  success: boolean;
  modifications: PackageJsonModification[];
  appliedSteps: FixStep[];
  errors: string[];
  warnings: string[];
  summary: {
    total: number;
    succeeded: number;
    failed: number;
  };
}

export class ResolutionApplier extends BaseGuard {
  private graph: DependencyGraph;
  private plan: ResolutionPlan;
  private options: ApplierOptions;

  constructor(
    graph: DependencyGraph,
    plan: ResolutionPlan,
    options?: ApplierOptions,
    context?: AuditContext
  ) {
    super('resolution-applier', context);
    this.graph = graph;
    this.plan = plan;
    this.options = {
      dryRun: true,
      autoApply: false,
      packageJsonPath: 'package.json',
      ...options,
    };
  }

  async execute(): Promise<AuditResult> {
    try {
      const result = this.apply();

      if (result.errors.length > 0) {
        const issues: AuditIssue[] = result.errors.map((error, i) =>
          this.createIssue(
            `APPLY_ERROR_${i}`,
            'error',
            'Resolution Application Error',
            error,
            undefined,
            'Review the error and adjust the plan'
          )
        );

        return this.issues(
          issues,
          `Failed to apply ${result.summary.failed} of ${result.summary.total} changes`
        );
      }

      if (result.warnings.length > 0) {
        const issues: AuditIssue[] = result.warnings.map((warning, i) =>
          this.createIssue(
            `APPLY_WARNING_${i}`,
            'warning',
            'Resolution Application Warning',
            warning,
            undefined,
            'Review warnings and test thoroughly'
          )
        );

        return this.issues(
          issues,
          `Applied ${result.summary.succeeded} changes with ${result.warnings.length} warning(s)`
        );
      }

      if (result.modifications.length === 0) {
        return this.ok('No modifications needed');
      }

      return this.ok(
        `Successfully applied ${result.summary.succeeded} changes to resolve dependencies`
      );
    } catch (error) {
      return this.createErrorResult(error);
    }
  }

  /**
   * Apply the resolution plan
   */
  apply(): ApplyResult {
    const modifications: PackageJsonModification[] = [];
    const appliedSteps: FixStep[] = [];
    const errors: string[] = [];
    const warnings: string[] = [];

    for (const step of this.plan.steps) {
      try {
        const modification = this.applyStep(step);

        if (modification) {
          modifications.push(modification);
          appliedSteps.push(step);
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        errors.push(`Failed to apply step ${step.id}: ${errorMsg}`);
      }
    }

    // Validate modifications
    const validation = this.validateModifications(modifications);
    warnings.push(...validation.warnings);

    if (this.options.dryRun) {
      warnings.push('DRY RUN MODE: Changes not actually applied to package.json');
    }

    return {
      success: errors.length === 0,
      modifications,
      appliedSteps,
      errors,
      warnings,
      summary: {
        total: this.plan.steps.length,
        succeeded: appliedSteps.length,
        failed: errors.length,
      },
    };
  }

  /**
   * Apply a single fix step
   */
  private applyStep(step: FixStep): PackageJsonModification | null {
    // Determine which field this package belongs to
    const field = this.determinePackageField(step.packageName);

    if (!field) {
      throw new Error(`Cannot determine package field for ${step.packageName}`);
    }

    return {
      field,
      packageName: step.packageName,
      oldVersion: step.currentVersion || 'unknown',
      newVersion: step.targetVersion,
      reason: step.reason,
    };
  }

  /**
   * Determine which field in package.json a package belongs to
   */
  private determinePackageField(
    packageName: string
  ): 'dependencies' | 'devDependencies' | 'peerDependencies' | 'optionalDependencies' | null {
    const nodes = this.graph.getNodes().filter(n => n.name === packageName);

    if (nodes.length === 0) {
      return 'dependencies';
    }

    const node = nodes[0];

    if (!node) {
      return 'dependencies';
    }

    if (node.isPeerDependency) {
      return 'peerDependencies';
    }

    if (node.isOptional) {
      return 'optionalDependencies';
    }

    if (node.isDirect) {
      return 'dependencies';
    }

    return 'devDependencies';
  }

  /**
   * Validate proposed modifications
   */
  private validateModifications(modifications: PackageJsonModification[]) {
    const warnings: string[] = [];
    const packageNames = new Set<string>();

    for (const mod of modifications) {
      // Check for duplicate modifications
      if (packageNames.has(mod.packageName)) {
        warnings.push(`Duplicate modification detected for ${mod.packageName}`);
      }
      packageNames.add(mod.packageName);

      // Check for downgrades
      if (this.isDowngrade(mod.oldVersion, mod.newVersion)) {
        warnings.push(
          `Downgrading ${mod.packageName} from ${mod.oldVersion} to ${mod.newVersion}. ` +
          `This may introduce security issues.`
        );
      }

      // Check for major version changes
      if (this.isMajorVersionChange(mod.oldVersion, mod.newVersion)) {
        warnings.push(
          `Major version change for ${mod.packageName}: ` +
          `${mod.oldVersion} → ${mod.newVersion}. Test thoroughly.`
        );
      }
    }

    return { warnings };
  }

  /**
   * Check if version change is a downgrade
   */
  private isDowngrade(oldVersion: string, newVersion: string): boolean {
    if (oldVersion === 'unknown' || !oldVersion) {
      return false;
    }

    try {
      const oldParts = oldVersion.split('.').map(Number);
      const newParts = newVersion.split('.').map(Number);

      for (let i = 0; i < Math.max(oldParts.length, newParts.length); i++) {
        const oldPart = oldParts[i] ?? 0;
        const newPart = newParts[i] ?? 0;

        if (newPart < oldPart) {
          return true;
        }
        if (newPart > oldPart) {
          return false;
        }
      }

      return false;
    } catch {
      return false;
    }
  }

  /**
   * Check if version change is a major version bump
   */
  private isMajorVersionChange(oldVersion: string, newVersion: string): boolean {
    if (oldVersion === 'unknown' || !oldVersion) {
      return false;
    }

    try {
      const oldPart = oldVersion.split('.')[0];
      const newPart = newVersion.split('.')[0];
      if (!oldPart || !newPart) return false;
      const oldMajor = parseInt(oldPart, 10);
      const newMajor = parseInt(newPart, 10);
      return Math.abs(newMajor - oldMajor) > 0;
    } catch {
      return false;
    }
  }

  /**
   * Generate suggested package.json changes
   */
  generatePackageJsonSuggestions(): Record<string, string> {
    const suggestions: Record<string, string> = {};

    for (const mod of this.plan.dependencies) {
      const [name, version] = mod.split('@');
      if (name && version) {
        suggestions[name] = version;
      }
    }

    return suggestions;
  }

  /**
   * Generate npm install commands for all changes
   */
  generateInstallCommands(): string[] {
    const commands: string[] = [];

    for (const step of this.plan.steps) {
      if (step.command) {
        commands.push(step.command);
      }
    }

    // Add a final npm ci for reproducible installs
    if (commands.length > 0) {
      commands.push('npm ci');
    }

    return commands;
  }

  /**
   * Export the resolution plan as JSON
   */
  exportPlan(): string {
    return JSON.stringify(
      {
        planId: this.plan.planId,
        timestamp: this.plan.timestamp,
        strategy: this.plan.strategyUsed,
        criticality: this.plan.criticality,
        steps: this.plan.steps,
        summary: this.plan.summary,
        warnings: this.plan.warnings,
      },
      null,
      2
    );
  }
}

/**
 * Helper function to apply resolution without needing full class instantiation
 */
export async function applyResolution(
  graph: DependencyGraph,
  plan: ResolutionPlan,
  options?: ApplierOptions,
  context?: AuditContext
): Promise<ApplyResult> {
  const applier = new ResolutionApplier(graph, plan, options, context);
  return applier.apply();
}
