import { describe, it, expect, beforeEach } from 'vitest';
import { DependencyGraph } from '../../../../src/core/resolution/dependency-graph.js';

describe('DependencyGraph', () => {
  let graph: DependencyGraph;

  beforeEach(() => {
    graph = new DependencyGraph();
  });

  describe('addDependency()', () => {
    it('should add a single dependency', () => {
      const node = graph.addDependency('lodash', '4.17.21');

      expect(node.name).toBe('lodash');
      expect(node.version).toBe('4.17.21');
      expect(node.resolved).toBe(false);
    });

    it('should add direct dependencies correctly', () => {
      const node = graph.addDependency('express', '4.18.0', { isDirect: true });

      expect(node.isDirect).toBe(true);
    });

    it('should add optional dependencies correctly', () => {
      const node = graph.addDependency('optional-lib', '1.0.0', { isOptional: true });

      expect(node.isOptional).toBe(true);
    });

    it('should not duplicate dependencies', () => {
      const node1 = graph.addDependency('react', '18.0.0');
      const node2 = graph.addDependency('react', '18.0.0');

      expect(node1).toBe(node2);
      expect(graph.getNodes().length).toBe(1);
    });

    it('should allow multiple versions of same package', () => {
      const node1 = graph.addDependency('react', '18.0.0');
      const node2 = graph.addDependency('react', '17.0.0');

      expect(node1).not.toBe(node2);
      expect(graph.getNodes().length).toBe(2);
    });
  });

  describe('addEdge()', () => {
    it('should create edge between dependencies', () => {
      const express = graph.addDependency('express', '4.18.0', { isDirect: true });
      const bodyParser = graph.addDependency('body-parser', '1.20.0');

      graph.addEdge(express, bodyParser);

      expect(express.dependencies.has('body-parser')).toBe(true);
      expect(bodyParser.dependents.has('express')).toBe(true);
    });

    it('should handle multiple edges correctly', () => {
      const react = graph.addDependency('react', '18.0.0', { isDirect: true });
      const prop = graph.addDependency('prop-types', '15.8.0');
      const scheduler = graph.addDependency('scheduler', '0.23.0');

      graph.addEdge(react, prop);
      graph.addEdge(react, scheduler);

      expect(react.dependencies.size).toBe(2);
      expect(scheduler.dependents.size).toBe(1);
    });
  });

  describe('detectConflicts()', () => {
    it('should detect no conflicts when versions match', () => {
      graph.addDependency('lodash', '4.17.21');
      const conflicts = graph.detectConflicts();

      expect(conflicts).toHaveLength(0);
    });

    it('should detect conflicts for same package with different versions', () => {
      graph.addDependency('react', '18.0.0');
      graph.addDependency('react', '17.0.0');

      const conflicts = graph.detectConflicts();

      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].name).toBe('react');
      expect(conflicts[0].versions.size).toBe(2);
    });

    it('should assign correct severity to conflicts', () => {
      graph.addDependency('lodash', '4.17.21', { isDirect: true });
      graph.addDependency('lodash', '3.10.1', { isDirect: true });

      const conflicts = graph.detectConflicts();

      expect(conflicts[0].severity).toBe('error');
    });

    it('should handle multiple conflicts', () => {
      graph.addDependency('react', '18.0.0');
      graph.addDependency('react', '17.0.0');
      graph.addDependency('vue', '3.0.0');
      graph.addDependency('vue', '2.7.0');

      const conflicts = graph.detectConflicts();

      expect(conflicts.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('findCircularDependencies()', () => {
    it('should detect no circles in linear dependency graph', () => {
      const a = graph.addDependency('a', '1.0.0');
      const b = graph.addDependency('b', '1.0.0');
      const c = graph.addDependency('c', '1.0.0');

      graph.addEdge(a, b);
      graph.addEdge(b, c);

      const circles = graph.findCircularDependencies();

      expect(circles).toHaveLength(0);
    });

    it('should detect circular dependency', () => {
      const a = graph.addDependency('a', '1.0.0');
      const b = graph.addDependency('b', '1.0.0');
      const c = graph.addDependency('c', '1.0.0');

      graph.addEdge(a, b);
      graph.addEdge(b, c);
      graph.addEdge(c, a);

      const circles = graph.findCircularDependencies();

      expect(circles.length).toBeGreaterThan(0);
      expect(circles[0]).toContain('a');
    });

    it('should detect self-referencing circular dependency', () => {
      const a = graph.addDependency('a', '1.0.0');

      graph.addEdge(a, a);

      const circles = graph.findCircularDependencies();

      expect(circles.length).toBeGreaterThan(0);
    });
  });

  describe('getDependents()', () => {
    it('should find all dependents of a package', () => {
      const express = graph.addDependency('express', '4.18.0');
      const app1 = graph.addDependency('app1', '1.0.0');
      const app2 = graph.addDependency('app2', '1.0.0');

      graph.addEdge(app1, express);
      graph.addEdge(app2, express);

      const dependents = graph.getDependents('express');

      expect(dependents.length).toBe(2);
      expect(dependents.map(d => d.name)).toContain('app1');
      expect(dependents.map(d => d.name)).toContain('app2');
    });

    it('should return empty array for package with no dependents', () => {
      graph.addDependency('unused', '1.0.0');

      const dependents = graph.getDependents('unused');

      expect(dependents).toHaveLength(0);
    });
  });

  describe('getDependencyTree()', () => {
    it('should build dependency tree correctly', () => {
      const react = graph.addDependency('react', '18.0.0');
      const prop = graph.addDependency('prop-types', '15.8.0');
      const scheduler = graph.addDependency('scheduler', '0.23.0');

      graph.addEdge(react, prop);
      graph.addEdge(react, scheduler);

      const tree = graph.getDependencyTree('react', 2);

      expect(tree.size).toBeGreaterThan(0);
    });

    it('should respect maxDepth parameter', () => {
      const a = graph.addDependency('a', '1.0.0');
      const b = graph.addDependency('b', '1.0.0');
      const c = graph.addDependency('c', '1.0.0');
      const d = graph.addDependency('d', '1.0.0');

      graph.addEdge(a, b);
      graph.addEdge(b, c);
      graph.addEdge(c, d);

      const tree = graph.getDependencyTree('a', 2);

      expect(tree.size).toBeLessThanOrEqual(3);
    });
  });

  describe('getNodes()', () => {
    it('should return all added nodes', () => {
      graph.addDependency('lodash', '4.17.21');
      graph.addDependency('express', '4.18.0');
      graph.addDependency('react', '18.0.0');

      const nodes = graph.getNodes();

      expect(nodes.length).toBe(3);
    });

    it('should return empty array for empty graph', () => {
      const nodes = graph.getNodes();

      expect(nodes).toHaveLength(0);
    });
  });

  describe('getConflicts()', () => {
    it('should return detected conflicts', () => {
      graph.addDependency('react', '18.0.0');
      graph.addDependency('react', '17.0.0');

      graph.detectConflicts();
      const conflicts = graph.getConflicts();

      expect(conflicts.length).toBeGreaterThan(0);
    });

    it('should return empty array when no conflicts', () => {
      graph.addDependency('lodash', '4.17.21');
      graph.detectConflicts();

      const conflicts = graph.getConflicts();

      expect(conflicts).toHaveLength(0);
    });
  });

  describe('isResolved()', () => {
    it('should return false when nodes are unresolved', () => {
      graph.addDependency('lodash', '4.17.21');

      expect(graph.isResolved()).toBe(false);
    });

    it('should return true when all nodes are resolved', () => {
      const _node = graph.addDependency('lodash', '4.17.21');
      graph.markResolved('lodash', '4.17.21');

      expect(graph.isResolved()).toBe(true);
    });

    it('should return true for empty graph', () => {
      expect(graph.isResolved()).toBe(true);
    });
  });

  describe('markResolved()', () => {
    it('should mark node as resolved', () => {
      graph.addDependency('express', '4.18.0');
      graph.markResolved('express', '4.18.0');

      const nodes = graph.getNodes();
      expect(nodes[0].resolved).toBe(true);
    });

    it('should handle marking non-existent node', () => {
      expect(() => {
        graph.markResolved('non-existent', '1.0.0');
      }).not.toThrow();
    });
  });

  describe('toJSON()', () => {
    it('should export graph as JSON', () => {
      graph.addDependency('lodash', '4.17.21');
      graph.addDependency('react', '18.0.0');
      graph.addDependency('react', '17.0.0');

      graph.detectConflicts();
      const json = graph.toJSON();

      expect(json.nodes).toBeDefined();
      expect(json.conflicts).toBeDefined();
      expect(json.nodes.length).toBe(3);
      expect(json.conflicts.length).toBeGreaterThan(0);
    });

    it('should include correct node information', () => {
      const node = graph.addDependency('express', '4.18.0', { isDirect: true });
      const dep = graph.addDependency('body-parser', '1.20.0');
      graph.addEdge(node, dep);

      const json = graph.toJSON();

      const expressNode = json.nodes.find(n => n.name === 'express');
      expect(expressNode?.dependencyCount).toBe(1);
      expect(expressNode?.isDirect).toBe(true);
    });
  });
});
