/**
 * Dependency Graph Module
 * Builds and analyzes a complete dependency graph for package resolution
 */

import { parse } from 'semver';

export interface Dependency {
  name: string;
  version: string;
  range?: string;
  isDirect?: boolean;
  isOptional?: boolean;
  isPeerDependency?: boolean;
}

export interface DependencyNode {
  name: string;
  version: string;
  range?: string;
  dependencies: Map<string, DependencyNode>;
  dependents: Map<string, DependencyNode>;
  isDirect: boolean;
  isOptional: boolean;
  isPeerDependency: boolean;
  resolved: boolean;
}

export interface DependencyConflict {
  name: string;
  versions: Set<string>;
  ranges: Set<string>;
  nodes: DependencyNode[];
  severity: 'critical' | 'error' | 'warning';
}

export class DependencyGraph {
  private nodes: Map<string, DependencyNode> = new Map();
  private conflicts: Map<string, DependencyConflict> = new Map();

  /**
   * Add a package and its dependencies to the graph
   */
  addDependency(name: string, version: string, options?: {
    range?: string;
    isDirect?: boolean;
    isOptional?: boolean;
    isPeerDependency?: boolean;
  }): DependencyNode {
    const key = `${name}@${version}`;

    if (this.nodes.has(key)) {
      return this.nodes.get(key)!;
    }

    const node: DependencyNode = {
      name,
      version,
      range: options?.range,
      dependencies: new Map(),
      dependents: new Map(),
      isDirect: options?.isDirect ?? false,
      isOptional: options?.isOptional ?? false,
      isPeerDependency: options?.isPeerDependency ?? false,
      resolved: false,
    };

    this.nodes.set(key, node);
    return node;
  }

  /**
   * Add an edge between two dependencies
   */
  addEdge(from: DependencyNode, to: DependencyNode): void {
    from.dependencies.set(to.name, to);
    to.dependents.set(from.name, from);
  }

  /**
   * Detect version conflicts in the dependency graph
   */
  detectConflicts(): DependencyConflict[] {
    const versionMap = new Map<string, Set<string>>();
    const nodeMap = new Map<string, DependencyNode[]>();

    // Group dependencies by name
    for (const node of this.nodes.values()) {
      if (!versionMap.has(node.name)) {
        versionMap.set(node.name, new Set());
        nodeMap.set(node.name, []);
      }
      versionMap.get(node.name)!.add(node.version);
      nodeMap.get(node.name)!.push(node);
    }

    const conflicts: DependencyConflict[] = [];

    // Find conflicts (same package, different versions)
    for (const [name, versions] of versionMap) {
      if (versions.size > 1) {
        const nodes = nodeMap.get(name) || [];
        const ranges = new Set<string>();

        for (const node of nodes) {
          if (node.range) {
            ranges.add(node.range);
          }
        }

        const severity = this.calculateConflictSeverity(name, versions, nodes);

        const conflict: DependencyConflict = {
          name,
          versions,
          ranges,
          nodes,
          severity,
        };

        conflicts.push(conflict);
        this.conflicts.set(name, conflict);
      }
    }

    return conflicts;
  }

  /**
   * Calculate conflict severity based on version distance and impact
   */
  private calculateConflictSeverity(
    _name: string,
    versions: Set<string>,
    nodes: DependencyNode[]
  ): 'critical' | 'error' | 'warning' {
    // If any version is direct dependency, it's more severe
    const hasDirect = nodes.some(n => n.isDirect);
    if (hasDirect) return 'error';

    // Check if versions are compatible (semantic versioning)
    const versionList = Array.from(versions).sort();
    if (versionList.length > 2) return 'error';

    // Two minor versions apart is warning, major versions is error
    try {
      const parsed = versionList.map(v => parse(v)).filter(p => p !== null);
      if (parsed.length >= 2) {
        const majorDiff = Math.abs((parsed[0]?.major ?? 0) - (parsed[1]?.major ?? 0));
        if (majorDiff > 0) return 'error';
      }
    } catch {
      // Ignore parse errors
    }

    return 'warning';
  }

  /**
   * Find circular dependencies
   */
  findCircularDependencies(): string[][] {
    const circles: string[][] = [];
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    for (const node of this.nodes.values()) {
      if (!visited.has(node.name)) {
        this.dfs(node, visited, recursionStack, [], circles);
      }
    }

    return circles;
  }

  /**
   * Depth-first search for circular dependencies
   */
  private dfs(
    node: DependencyNode,
    visited: Set<string>,
    recursionStack: Set<string>,
    path: string[],
    circles: string[][]
  ): void {
    visited.add(node.name);
    recursionStack.add(node.name);
    path.push(node.name);

    for (const dependency of node.dependencies.values()) {
      if (!visited.has(dependency.name)) {
        this.dfs(dependency, visited, recursionStack, path, circles);
      } else if (recursionStack.has(dependency.name)) {
        const circleStart = path.indexOf(dependency.name);
        if (circleStart !== -1) {
          circles.push([...path.slice(circleStart), dependency.name]);
        }
      }
    }

    recursionStack.delete(node.name);
    path.pop();
  }

  /**
   * Get all dependencies that depend on a specific package
   */
  getDependents(packageName: string): DependencyNode[] {
    const dependents: DependencyNode[] = [];

    for (const node of this.nodes.values()) {
      if (node.name === packageName) {
        for (const dependent of node.dependents.values()) {
          dependents.push(dependent);
        }
      }
    }

    return dependents;
  }

  /**
   * Get dependency tree for a specific package
   */
  getDependencyTree(packageName: string, maxDepth = 5): Map<string, DependencyNode[]> {
    const tree = new Map<string, DependencyNode[]>();
    const visited = new Set<string>();

    this.buildTree(packageName, 0, maxDepth, tree, visited);
    return tree;
  }

  /**
   * Recursively build dependency tree
   */
  private buildTree(
    packageName: string,
    depth: number,
    maxDepth: number,
    tree: Map<string, DependencyNode[]>,
    visited: Set<string>
  ): void {
    if (depth > maxDepth || visited.has(packageName)) {
      return;
    }

    visited.add(packageName);

    for (const node of this.nodes.values()) {
      if (node.name === packageName) {
        if (!tree.has(`depth_${depth}`)) {
          tree.set(`depth_${depth}`, []);
        }
        tree.get(`depth_${depth}`)!.push(node);

        for (const dep of node.dependencies.values()) {
          this.buildTree(dep.name, depth + 1, maxDepth, tree, visited);
        }
      }
    }
  }

  /**
   * Get all nodes in the graph
   */
  getNodes(): DependencyNode[] {
    return Array.from(this.nodes.values());
  }

  /**
   * Get conflicts detected in the graph
   */
  getConflicts(): DependencyConflict[] {
    return Array.from(this.conflicts.values());
  }

  /**
   * Check if graph is fully resolved (no unresolved nodes)
   */
  isResolved(): boolean {
    return Array.from(this.nodes.values()).every(node => node.resolved);
  }

  /**
   * Mark a node as resolved
   */
  markResolved(name: string, version: string): void {
    const key = `${name}@${version}`;
    const node = this.nodes.get(key);
    if (node) {
      node.resolved = true;
    }
  }

  /**
   * Export graph as JSON for analysis
   */
  toJSON() {
    return {
      nodes: Array.from(this.nodes.values()).map(node => ({
        name: node.name,
        version: node.version,
        isDirect: node.isDirect,
        resolved: node.resolved,
        dependencyCount: node.dependencies.size,
        dependentCount: node.dependents.size,
      })),
      conflicts: Array.from(this.conflicts.values()).map(c => ({
        name: c.name,
        versions: Array.from(c.versions),
        severity: c.severity,
      })),
    };
  }
}
