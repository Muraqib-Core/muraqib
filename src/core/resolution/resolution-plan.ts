/**
 * Resolution Plan Module
 * Generates actionable fix plans based on resolution results
 */

import type { DependencyGraph } from './dependency-graph.js';
import type { ResolutionResult, ResolutionOption } from './resolution-engine.js';

export interface FixStep {
  id: string;
  action: 'upgrade' | 'downgrade' | 'pin' | 'remove' | 'add' | 'resolve-conflict';
  packageName: string;
  currentVersion?: string;
  targetVersion: string;
  reason: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  affectedPackages?: string[];
  command?: string;
}

export interface ResolutionPlan {
  planId: string;
  timestamp: number;
  strategyUsed: string;
  totalSteps: number;
  criticality: 'safe' | 'risky' | 'breaking';
  steps: FixStep[];
  summary: {
    upgrades: number;
    downgrades: number;
    removals: number;
    additions: number;
    conflicts: number;
  };
  estimatedImpact: {
    bundleSize?: string;
    performanceRisk: 'low' | 'medium' | 'high';
    breakingChanges: number;
  };
  dependencies: string[];
  warnings: string[];
  notes: string[];
}

export class ResolutionPlanner {
  private graph: DependencyGraph;
  private resolutionResult: ResolutionResult;

  constructor(graph: DependencyGraph, resolutionResult: ResolutionResult) {
    this.graph = graph;
    this.resolutionResult = resolutionResult;
  }

  /**
   * Generate a complete resolution plan
   */
  generatePlan(): ResolutionPlan {
    const planId = this.generatePlanId();
    const steps = this.generateFixSteps();
    const summary = this.calculateSummary(steps);
    const criticality = this.assessCriticality(steps);
    const warnings = this.generateWarnings(steps);
    const notes = this.generateNotes();

    return {
      planId,
      timestamp: Date.now(),
      strategyUsed: this.resolutionResult.strategy,
      totalSteps: steps.length,
      criticality,
      steps,
      summary,
      estimatedImpact: {
        performanceRisk: this.assessPerformanceRisk(steps),
        breakingChanges: this.countBreakingChanges(steps),
      },
      dependencies: this.extractDependencies(steps),
      warnings,
      notes,
    };
  }

  /**
   * Generate individual fix steps from resolution result
   */
  private generateFixSteps(): FixStep[] {
    const steps: FixStep[] = [];
    let stepCounter = 1;

    // Process each resolution option
    for (const option of this.resolutionResult.options) {
      const step = this.createFixStep(stepCounter++, option);
      steps.push(step);
    }

    // Add conflict resolution steps
    for (const conflict of this.resolutionResult.conflicts) {
      if (!this.resolutionResult.resolutions.has(conflict.name)) {
        const step: FixStep = {
          id: `step_${stepCounter++}`,
          action: 'resolve-conflict',
          packageName: conflict.name,
          targetVersion: Array.from(conflict.versions)[0] || 'latest',
          reason: `Unresolved conflict: ${Array.from(conflict.versions).join(', ')}`,
          priority: conflict.severity === 'critical' ? 'critical' : 'high',
          affectedPackages: Array.from(conflict.versions).map((v) => `${conflict.name}@${v}`),
        };
        steps.push(step);
      }
    }

    // Sort steps by priority
    steps.sort((a, b) => {
      const priorityMap = { critical: 0, high: 1, medium: 2, low: 3 };
      return priorityMap[a.priority] - priorityMap[b.priority];
    });

    return steps;
  }

  /**
   * Create a single fix step from resolution option
   */
  private createFixStep(index: number, option: ResolutionOption): FixStep {
    const isUpgrade = this.isUpgrade(option.packageName, option.selectedVersion);
    const action = isUpgrade ? 'upgrade' : 'downgrade';
    const priority = option.confidence > 0.9 ? 'critical' : option.confidence > 0.7 ? 'high' : 'medium';

    return {
      id: `step_${index}`,
      action,
      packageName: option.packageName,
      targetVersion: option.selectedVersion,
      reason: option.reason,
      priority,
      affectedPackages: option.affectedPackages,
      command: `npm install ${option.packageName}@${option.selectedVersion}`,
    };
  }

  /**
   * Check if an update is an upgrade or downgrade
   */
  private isUpgrade(packageName: string, newVersion: string): boolean {
    const nodes = this.graph.getNodes().filter(n => n.name === packageName);
    if (nodes.length === 0) return true;

    const maxVersion = nodes.map(n => n.version).sort().pop();
    if (!maxVersion) return true;

    try {
      const maxParts = maxVersion.split('.').map(Number);
      const newParts = newVersion.split('.').map(Number);

      for (let i = 0; i < Math.max(maxParts.length, newParts.length); i++) {
        const maxPart = maxParts[i] ?? 0;
        const newPart = newParts[i] ?? 0;
        if (newPart > maxPart) return true;
        if (newPart < maxPart) return false;
      }
      return false;
    } catch {
      return true;
    }
  }

  /**
   * Calculate summary statistics
   */
  private calculateSummary(steps: FixStep[]) {
    return {
      upgrades: steps.filter(s => s.action === 'upgrade').length,
      downgrades: steps.filter(s => s.action === 'downgrade').length,
      removals: steps.filter(s => s.action === 'remove').length,
      additions: steps.filter(s => s.action === 'add').length,
      conflicts: this.resolutionResult.conflicts.length,
    };
  }

  /**
   * Assess overall plan criticality
   */
  private assessCriticality(steps: FixStep[]): 'safe' | 'risky' | 'breaking' {
    const breakingCount = this.countBreakingChanges(steps);
    const downgrades = steps.filter(s => s.action === 'downgrade').length;
    const criticalSteps = steps.filter(s => s.priority === 'critical').length;

    if (breakingCount > 0 || this.resolutionResult.unresolvable.length > 0) {
      return 'breaking';
    }

    if (downgrades > 0 || criticalSteps > 2) {
      return 'risky';
    }

    return 'safe';
  }

  /**
   * Assess performance risk
   */
  private assessPerformanceRisk(steps: FixStep[]): 'low' | 'medium' | 'high' {
    const criticalUpdates = steps.filter(s => s.priority === 'critical').length;
    const majorUpdates = steps.filter(s => this.isMajorUpdate(s)).length;

    if (majorUpdates > 3 || criticalUpdates > 2) {
      return 'high';
    }

    if (majorUpdates > 0 || criticalUpdates > 0) {
      return 'medium';
    }

    return 'low';
  }

  /**
   * Check if step is a major version update
   */
  private isMajorUpdate(step: FixStep): boolean {
    if (!step.currentVersion || typeof step.currentVersion !== 'string') return false;

    try {
      const currentPart = step.currentVersion.split('.')[0];
      const targetPart = step.targetVersion.split('.')[0];
      if (!currentPart || !targetPart) return false;
      const currentMajor = parseInt(currentPart, 10);
      const targetMajor = parseInt(targetPart, 10);
      return targetMajor > currentMajor;
    } catch {
      return false;
    }
  }

  /**
   * Count breaking changes in the plan
   */
  private countBreakingChanges(steps: FixStep[]): number {
    return steps.filter(s => this.isMajorUpdate(s)).length;
  }

  /**
   * Generate warnings for the plan
   */
  private generateWarnings(steps: FixStep[]): string[] {
    const warnings: string[] = [];

    if (this.resolutionResult.unresolvable.length > 0) {
      warnings.push(
        `Unable to resolve: ${this.resolutionResult.unresolvable.join(', ')}`
      );
    }

    const downgrades = steps.filter(s => s.action === 'downgrade');
    if (downgrades.length > 0) {
      warnings.push(
        `${downgrades.length} package(s) will be downgraded. This may introduce vulnerabilities.`
      );
    }

    const majorUpdates = steps.filter(s => this.isMajorUpdate(s));
    if (majorUpdates.length > 0) {
      warnings.push(
        `${majorUpdates.length} major version update(s) detected. Test thoroughly before deploying.`
      );
    }

    const circles = this.graph.findCircularDependencies();
    if (circles.length > 0) {
      warnings.push(
        `Circular dependencies detected: ${circles.map(c => c.join(' -> ')).join('; ')}`
      );
    }

    return warnings;
  }

  /**
   * Generate helpful notes for the plan
   */
  private generateNotes(): string[] {
    return [
      '1. Review all changes before applying this plan',
      '2. Run tests after applying the plan',
      '3. Update lockfile: npm install',
      '4. Consider using npm ci for reproducible installs',
      `5. Strategy used: ${this.resolutionResult.strategy}`,
    ];
  }

  /**
   * Extract all affected dependencies
   */
  private extractDependencies(steps: FixStep[]): string[] {
    const deps = new Set<string>();

    for (const step of steps) {
      deps.add(`${step.packageName}@${step.targetVersion}`);
      if (step.affectedPackages) {
        step.affectedPackages.forEach(p => deps.add(p));
      }
    }

    return Array.from(deps);
  }

  /**
   * Generate unique plan ID
   */
  private generatePlanId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `plan_${timestamp}_${random}`;
  }
}
