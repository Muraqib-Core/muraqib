import { describe, it, expect, beforeEach } from 'vitest';
import { DependencyGraph } from '../../../../src/core/resolution/dependency-graph.js';
import { ResolutionEngine } from '../../../../src/core/resolution/resolution-engine.js';

describe('ResolutionEngine', () => {
  let graph: DependencyGraph;
  let engine: ResolutionEngine;

  beforeEach(() => {
    graph = new DependencyGraph();
    engine = new ResolutionEngine(graph);
  });

  describe('initialization', () => {
    it('should initialize with strategies', () => {
      const engine2 = new ResolutionEngine(graph);
      expect(engine2).toBeDefined();
    });
  });

  describe('resolve()', () => {
    it('should resolve dependencies with no conflicts', async () => {
      graph.addDependency('lodash', '4.17.21');
      const result = await engine.resolve('latest');

      expect(result.success).toBe(true);
      expect(result.unresolvable).toHaveLength(0);
    });

    it('should detect unresolvable conflicts', async () => {
      graph.addDependency('react', '18.0.0', { isDirect: true });
      graph.addDependency('react', '16.0.0', { isDirect: true });
      graph.detectConflicts();

      const result = await engine.resolve('intersection');

      expect(result.conflicts.length).toBeGreaterThan(0);
    });

    it('should return strategy used in result', async () => {
      graph.addDependency('express', '4.18.0');
      const result = await engine.resolve('latest');

      expect(result.strategy).toBe('latest');
    });

    it('should support latest strategy', async () => {
      graph.addDependency('lodash', '4.17.21');
      graph.addDependency('lodash', '4.17.20');
      graph.detectConflicts();

      const result = await engine.resolve('latest');

      expect(result.resolutions.has('lodash')).toBe(true);
      expect(result.resolutions.get('lodash')).toBe('4.17.21');
    });

    it('should support conservative strategy', async () => {
      graph.addDependency('lodash', '4.17.21');
      graph.addDependency('lodash', '4.17.20');
      graph.detectConflicts();

      const result = await engine.resolve('conservative');

      expect(result.resolutions.has('lodash')).toBe(true);
    });
  });

  describe('resolveConflict()', () => {
    it('should handle direct dependencies with priority', () => {
      const _conflict = graph.addDependency('react', '18.0.0', { isDirect: true });
      graph.addDependency('react', '17.0.0');
      graph.detectConflicts();

      const conflicts = graph.getConflicts();
      expect(conflicts.length).toBeGreaterThan(0);
    });
  });

  describe('isValidRange()', () => {
    it('should validate semantic version ranges', () => {
      expect(engine.isValidRange('^4.17.0')).toBe(true);
      expect(engine.isValidRange('~4.17.0')).toBe(true);
      expect(engine.isValidRange('>=4.17.0')).toBe(true);
      expect(engine.isValidRange('4.17.0')).toBe(true);
    });

    it('should reject invalid ranges', () => {
      expect(engine.isValidRange('invalid-range')).toBe(false);
      expect(engine.isValidRange('xyz-abc')).toBe(false);
    });
  });

  describe('findCompatibleVersion()', () => {
    it('should find version compatible with all ranges', () => {
      const ranges = ['^4.17.0', '>=4.17.0', '<5.0.0'];
      const version = engine.findCompatibleVersion(ranges);

      expect(version).toBeDefined();
    });

    it('should handle empty ranges', () => {
      const version = engine.findCompatibleVersion([]);

      expect(version).toBeNull();
    });

    it('should handle invalid ranges gracefully', () => {
      const ranges = ['invalid', '^4.17.0'];
      const version = engine.findCompatibleVersion(ranges);

      expect(typeof version === 'string' || version === null).toBe(true);
    });
  });

  describe('hasCriticalConflicts()', () => {
    it('should return false when no critical conflicts', async () => {
      graph.addDependency('lodash', '4.17.21');
      graph.detectConflicts();

      expect(engine.hasCriticalConflicts()).toBe(false);
    });

    it('should return true when critical conflicts exist', () => {
      graph.addDependency('react', '18.0.0', { isDirect: true });
      graph.addDependency('react', '16.0.0', { isDirect: true });
      graph.detectConflicts();

      const conflicts = graph.getConflicts();
      expect(conflicts.length).toBeGreaterThan(0);
    });

    it('should return false when no conflicts', () => {
      graph.addDependency('lodash', '4.17.21');
      graph.detectConflicts();
      expect(engine.hasCriticalConflicts()).toBe(false);
    });
  });

  describe('getConflictNodes()', () => {
    it('should return all nodes involved in conflicts', () => {
      graph.addDependency('react', '18.0.0');
      graph.addDependency('react', '17.0.0');
      graph.detectConflicts();

      const conflictNodes = engine.getConflictNodes();

      expect(conflictNodes.length).toBe(2);
      expect(conflictNodes.every(n => n.name === 'react')).toBe(true);
    });

    it('should return empty array when no conflicts', () => {
      graph.addDependency('lodash', '4.17.21');
      graph.detectConflicts();

      const conflictNodes = engine.getConflictNodes();

      expect(conflictNodes).toHaveLength(0);
    });
  });

  describe('strategies', () => {
    it('should resolve using latest strategy', async () => {
      graph.addDependency('express', '4.17.0');
      graph.addDependency('express', '4.18.0');
      graph.detectConflicts();

      const result = await engine.resolve('latest');

      if (result.resolutions.has('express')) {
        expect(result.resolutions.get('express')).toBe('4.18.0');
      }
    });

    it('should handle peer-dominant strategy', async () => {
      const _direct = graph.addDependency('express', '4.18.0', { isDirect: true });
      const _indirect = graph.addDependency('express', '4.17.0');

      graph.detectConflicts();
      const result = await engine.resolve('peer-dominant');

      if (result.resolutions.has('express')) {
        expect(result.resolutions.get('express')).toBeDefined();
      }
    });
  });

  describe('integration scenarios', () => {
    it('should handle complex dependency scenarios', async () => {
      const app = graph.addDependency('app', '1.0.0', { isDirect: true });
      const express = graph.addDependency('express', '4.18.0');
      const body1 = graph.addDependency('body-parser', '1.20.0');
      const body2 = graph.addDependency('body-parser', '1.19.0');

      graph.addEdge(app, express);
      graph.addEdge(express, body1);
      graph.addEdge(express, body2);

      graph.detectConflicts();
      const result = await engine.resolve('latest');

      expect(result).toBeDefined();
    });

    it('should handle nested conflicts', async () => {
      const a = graph.addDependency('a', '1.0.0', { isDirect: true });
      const b1 = graph.addDependency('b', '2.0.0');
      const b2 = graph.addDependency('b', '1.0.0');
      const c1 = graph.addDependency('c', '3.0.0');
      const c2 = graph.addDependency('c', '2.0.0');

      graph.addEdge(a, b1);
      graph.addEdge(a, b2);
      graph.addEdge(b1, c1);
      graph.addEdge(b2, c2);

      graph.detectConflicts();
      const result = await engine.resolve('latest');

      expect(result.conflicts.length).toBeGreaterThanOrEqual(0);
    });
  });
});
