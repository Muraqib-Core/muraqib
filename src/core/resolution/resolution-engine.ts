/**
 * Resolution Engine Module
 * Core logic for automatically resolving dependency conflicts
 */

import { satisfies, minVersion } from 'semver';
import type { DependencyGraph, DependencyConflict, DependencyNode } from './dependency-graph.js';

export interface ResolutionStrategy {
  name: string;
  description: string;
  priority: number;
}

export interface ResolutionOption {
  packageName: string;
  selectedVersion: string;
  reason: string;
  confidence: number;
  affectedPackages: string[];
}

export interface ResolutionResult {
  success: boolean;
  resolutions: Map<string, string>;
  options: ResolutionOption[];
  conflicts: DependencyConflict[];
  unresolvable: string[];
  strategy: string;
}

export class ResolutionEngine {
  private graph: DependencyGraph;
  private strategies: Map<string, ResolutionStrategy> = new Map();

  constructor(graph: DependencyGraph) {
    this.graph = graph;
    this.initializeStrategies();
  }

  /**
   * Initialize resolution strategies
   */
  private initializeStrategies(): void {
    this.strategies.set('latest', {
      name: 'latest',
      description: 'Use latest available version',
      priority: 1,
    });

    this.strategies.set('conservative', {
      name: 'conservative',
      description: 'Use lowest compatible version',
      priority: 2,
    });

    this.strategies.set('intersection', {
      name: 'intersection',
      description: 'Find version satisfying all ranges',
      priority: 3,
    });

    this.strategies.set('peer-dominant', {
      name: 'peer-dominant',
      description: 'Prioritize peer dependencies',
      priority: 4,
    });
  }

  /**
   * Automatically resolve all conflicts in the graph
   */
  async resolve(strategyName: string = 'intersection'): Promise<ResolutionResult> {
    const conflicts = this.graph.detectConflicts();
    const resolutions = new Map<string, string>();
    const options: ResolutionOption[] = [];
    const unresolvable: string[] = [];

    for (const conflict of conflicts) {
      const resolution = this.resolveConflict(conflict, strategyName);

      if (resolution) {
        resolutions.set(conflict.name, resolution.selectedVersion);
        options.push(resolution);
      } else {
        unresolvable.push(conflict.name);
      }
    }

    // Check for circular dependencies
    const circles = this.graph.findCircularDependencies();
    if (circles.length > 0) {
      for (const circle of circles) {
        unresolvable.push(`Circular: ${circle.join(' -> ')}`);
      }
    }

    return {
      success: unresolvable.length === 0,
      resolutions,
      options,
      conflicts,
      unresolvable,
      strategy: strategyName,
    };
  }

  /**
   * Resolve a single conflict using the specified strategy
   */
  private resolveConflict(conflict: DependencyConflict, strategyName: string): ResolutionOption | null {
    if (strategyName === 'intersection') {
      return this.resolveByIntersection(conflict);
    } else if (strategyName === 'latest') {
      return this.resolveByLatest(conflict);
    } else if (strategyName === 'conservative') {
      return this.resolveByConservative(conflict);
    } else if (strategyName === 'peer-dominant') {
      return this.resolveByPeerDominant(conflict);
    }

    return this.resolveByLatest(conflict);
  }

  /**
   * Resolve by finding version that satisfies all ranges
   */
  private resolveByIntersection(conflict: DependencyConflict): ResolutionOption | null {
    const ranges = Array.from(conflict.ranges);
    const versions = Array.from(conflict.versions).sort();

    // Find version satisfying all ranges
    for (const version of versions) {
      let satisfiesAll = true;
      for (const range of ranges) {
        try {
          if (!satisfies(version, range)) {
            satisfiesAll = false;
            break;
          }
        } catch {
          // Invalid range, skip
          satisfiesAll = false;
          break;
        }
      }

      if (satisfiesAll) {
        return {
          packageName: conflict.name,
          selectedVersion: version,
          reason: `Version ${version} satisfies all version ranges: ${ranges.join(', ')}`,
          confidence: 0.95,
          affectedPackages: conflict.nodes.map(n => n.name),
        };
      }
    }

    return null;
  }

  /**
   * Resolve by selecting the latest version
   */
  private resolveByLatest(conflict: DependencyConflict): ResolutionOption | null {
    const versions = Array.from(conflict.versions).sort();
    const latest = versions[versions.length - 1];

    if (!latest || typeof latest !== 'string') {
      return null;
    }

    // Check if latest is direct dependency
    const directNode = conflict.nodes.find(n => n.isDirect);

    return {
      packageName: conflict.name,
      selectedVersion: latest,
      reason: `Using latest version ${latest}${directNode ? ' (direct dependency)' : ''}`,
      confidence: directNode ? 0.9 : 0.7,
      affectedPackages: conflict.nodes.map(n => n.name),
    };
  }

  /**
   * Resolve by selecting lowest compatible version
   */
  private resolveByConservative(conflict: DependencyConflict): ResolutionOption | null {
    const versions = Array.from(conflict.versions).sort();
    const conservative = versions[0];

    if (!conservative || typeof conservative !== 'string') {
      return null;
    }

    return {
      packageName: conflict.name,
      selectedVersion: conservative,
      reason: `Using lowest version ${conservative} for stability`,
      confidence: 0.6,
      affectedPackages: conflict.nodes.map(n => n.name),
    };
  }

  /**
   * Resolve by prioritizing peer dependencies
   */
  private resolveByPeerDominant(conflict: DependencyConflict): ResolutionOption | null {
    // Prioritize direct dependencies
    const directNodes = conflict.nodes.filter(n => n.isDirect);
    if (directNodes.length > 0) {
      const versions = directNodes.map(n => n.version).sort();
      const latest = versions[versions.length - 1];
      if (latest) {
        return {
          packageName: conflict.name,
          selectedVersion: latest,
          reason: `Using direct dependency version ${latest}`,
          confidence: 0.95,
          affectedPackages: conflict.nodes.map(n => n.name),
        };
      }
    }

    // Then prioritize peer dependencies
    const peerNodes = conflict.nodes.filter(n => n.isPeerDependency);
    if (peerNodes.length > 0) {
      const versions = peerNodes.map(n => n.version).sort();
      const latest = versions[versions.length - 1];
      if (latest) {
        return {
          packageName: conflict.name,
          selectedVersion: latest,
          reason: `Using peer dependency version ${latest}`,
          confidence: 0.85,
          affectedPackages: conflict.nodes.map(n => n.name),
        };
      }
    }

    return this.resolveByLatest(conflict);
  }

  /**
   * Check if a version range is valid
   */
  isValidRange(range: string): boolean {
    try {
      minVersion(range);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Find compatible version for multiple ranges
   */
  findCompatibleVersion(ranges: string[]): string | null {
    const validRanges = ranges.filter(r => this.isValidRange(r));
    if (validRanges.length === 0) {
      return null;
    }

    // Try to find a version that satisfies all ranges
    // This is a simplified approach - real implementation would be more complex
    const minVer = validRanges.map(r => {
      try {
        return minVersion(r);
      } catch {
        return null;
      }
    }).filter(v => v !== null)[0];

    if (!minVer) {
      return null;
    }

    for (const range of validRanges) {
      try {
        if (!satisfies(minVer.version, range)) {
          return null;
        }
      } catch {
        return null;
      }
    }

    return minVer.version;
  }

  /**
   * Check if conflicts are critical
   */
  hasCriticalConflicts(): boolean {
    const conflicts = this.graph.getConflicts();
    return conflicts.some(c => c.severity === 'critical');
  }

  /**
   * Get all nodes involved in conflicts
   */
  getConflictNodes(): DependencyNode[] {
    const nodes = new Set<DependencyNode>();
    const conflicts = this.graph.getConflicts();

    for (const conflict of conflicts) {
      for (const node of conflict.nodes) {
        nodes.add(node);
      }
    }

    return Array.from(nodes);
  }
}
