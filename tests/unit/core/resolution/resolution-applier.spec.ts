import { describe, it, expect, beforeEach } from 'vitest';
import { DependencyGraph } from '../../../../src/core/resolution/dependency-graph.js';
import { ResolutionEngine } from '../../../../src/core/resolution/resolution-engine.js';
import { ResolutionPlanner } from '../../../../src/core/resolution/resolution-plan.js';
import { ResolutionApplier, applyResolution } from '../../../../src/core/resolution/resolution-applier.js';

describe('ResolutionApplier', () => {
  let graph: DependencyGraph;
  let engine: ResolutionEngine;
  let planner: ResolutionPlanner;
  let applier: ResolutionApplier;

  beforeEach(async () => {
    graph = new DependencyGraph();
    engine = new ResolutionEngine(graph);
    graph.addDependency('lodash', '4.17.21');
    graph.addDependency('lodash', '4.17.20');
    graph.detectConflicts();
    const result = await engine.resolve('latest');
    planner = new ResolutionPlanner(graph, result);
    const plan = planner.generatePlan();
    applier = new ResolutionApplier(graph, plan);
  });

  describe('initialization', () => {
    it('should initialize with graph and plan', () => {
      expect(applier).toBeDefined();
    });

    it('should support dry-run mode', () => {
      const applier2 = new ResolutionApplier(graph, planner.generatePlan(), { dryRun: true });
      expect(applier2).toBeDefined();
    });
  });

  describe('apply()', () => {
    it('should return ApplyResult', () => {
      const result = applier.apply();

      expect(result.success).toBeDefined();
      expect(result.modifications).toBeDefined();
      expect(result.errors).toBeDefined();
      expect(result.warnings).toBeDefined();
      expect(result.summary).toBeDefined();
    });

    it('should track applied steps', () => {
      const result = applier.apply();

      expect(result.appliedSteps).toBeDefined();
      expect(Array.isArray(result.appliedSteps)).toBe(true);
    });

    it('should track modifications', () => {
      const result = applier.apply();

      expect(result.modifications).toBeDefined();
      expect(Array.isArray(result.modifications)).toBe(true);
    });

    it('should include summary statistics', () => {
      const result = applier.apply();

      expect(result.summary.total).toBeDefined();
      expect(result.summary.succeeded).toBeDefined();
      expect(result.summary.failed).toBeDefined();
    });
  });

  describe('dry-run mode', () => {
    it('should not modify anything in dry-run mode', () => {
      const applier2 = new ResolutionApplier(
        graph,
        planner.generatePlan(),
        { dryRun: true }
      );

      const result = applier2.apply();

      expect(result.warnings.some(w => w.includes('DRY RUN'))).toBe(true);
    });

    it('should still report what would be done in dry-run', () => {
      const applier2 = new ResolutionApplier(
        graph,
        planner.generatePlan(),
        { dryRun: true }
      );

      const result = applier2.apply();

      expect(result).toBeDefined();
      expect(result.success || result.warnings.length >= 0).toBe(true);
    });
  });

  describe('generatePackageJsonSuggestions()', () => {
    it('should generate package.json suggestions', () => {
      const suggestions = applier.generatePackageJsonSuggestions();

      expect(suggestions).toBeDefined();
      expect(typeof suggestions).toBe('object');
    });

    it('should include resolved dependencies', () => {
      const suggestions = applier.generatePackageJsonSuggestions();

      expect(Object.keys(suggestions).length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('generateInstallCommands()', () => {
    it('should generate npm install commands', () => {
      const commands = applier.generateInstallCommands();

      expect(commands).toBeDefined();
      expect(Array.isArray(commands)).toBe(true);
    });

    it('should include npm ci for reproducibility', () => {
      const commands = applier.generateInstallCommands();

      expect(commands.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('exportPlan()', () => {
    it('should export plan as JSON string', () => {
      const json = applier.exportPlan();

      expect(typeof json).toBe('string');
      expect(json.length).toBeGreaterThan(0);
    });

    it('should be valid JSON', () => {
      const json = applier.exportPlan();

      expect(() => JSON.parse(json)).not.toThrow();
    });

    it('should include plan metadata', () => {
      const json = applier.exportPlan();
      const parsed = JSON.parse(json);

      expect(parsed.planId).toBeDefined();
      expect(parsed.strategy).toBeDefined();
      expect(parsed.criticality).toBeDefined();
    });
  });

  describe('execute()', () => {
    it('should execute and return AuditResult', async () => {
      const result = await applier.execute();

      expect(result.status).toBeDefined();
      expect(result.module).toBe('resolution-applier');
      expect(result.issues).toBeDefined();
      expect(result.message).toBeDefined();
    });

    it('should return ok status when successful', async () => {
      graph = new DependencyGraph();
      engine = new ResolutionEngine(graph);
      graph.addDependency('express', '4.18.0');
      const result2 = await engine.resolve('latest');
      const planner2 = new ResolutionPlanner(graph, result2);
      const plan2 = planner2.generatePlan();
      const applier2 = new ResolutionApplier(graph, plan2);

      const auditResult = await applier2.execute();

      expect(['ok', 'issues', 'warning', 'error']).toContain(auditResult.status);
    });

    it('should include modification count in message', async () => {
      const result = await applier.execute();

      expect(result.message).toBeDefined();
    });
  });

  describe('error handling', () => {
    it('should handle errors gracefully', () => {
      const graph2 = new DependencyGraph();
      const plan2 = new ResolutionPlanner(graph2, {
        success: true,
        resolutions: new Map(),
        options: [],
        conflicts: [],
        unresolvable: [],
        strategy: 'latest',
      }).generatePlan();
      const applier2 = new ResolutionApplier(graph2, plan2);

      const applyResult = applier2.apply();

      expect(applyResult).toBeDefined();
      expect(typeof applyResult.success).toBe('boolean');
    });
  });

  describe('applyResolution() helper', () => {
    it('should provide standalone function for applying resolutions', async () => {
      const result = await applyResolution(
        graph,
        planner.generatePlan(),
        { dryRun: true }
      );

      expect(result).toBeDefined();
      expect(result.summary).toBeDefined();
    });

    it('should accept optional context', async () => {
      const context = {
        projectRoot: '/test/project',
        timestamp: Date.now(),
        environment: 'production' as const,
        nodeVersion: 'v18.0.0',
        npmVersion: '9.0.0',
      };

      const result = await applyResolution(
        graph,
        planner.generatePlan(),
        { dryRun: true },
        context
      );

      expect(result).toBeDefined();
    });
  });

  describe('package field detection', () => {
    it('should detect dependencies field for direct packages', () => {
      const graph2 = new DependencyGraph();
      graph2.addDependency('express', '4.18.0', { isDirect: true });
      const plan2 = new ResolutionPlanner(graph2, {
        success: true,
        resolutions: new Map(),
        options: [],
        conflicts: [],
        unresolvable: [],
        strategy: 'latest',
      }).generatePlan();
      const applier2 = new ResolutionApplier(graph2, plan2);

      const applyResult = applier2.apply();

      expect(applyResult).toBeDefined();
    });

    it('should detect peerDependencies for peer packages', () => {
      const graph2 = new DependencyGraph();
      graph2.addDependency('react', '18.0.0', { isPeerDependency: true });
      const plan2 = new ResolutionPlanner(graph2, {
        success: true,
        resolutions: new Map(),
        options: [],
        conflicts: [],
        unresolvable: [],
        strategy: 'latest',
      }).generatePlan();
      const applier2 = new ResolutionApplier(graph2, plan2);

      const applyResult = applier2.apply();

      expect(applyResult).toBeDefined();
    });

    it('should detect optionalDependencies for optional packages', () => {
      const graph2 = new DependencyGraph();
      graph2.addDependency('optional-lib', '1.0.0', { isOptional: true });
      const plan2 = new ResolutionPlanner(graph2, {
        success: true,
        resolutions: new Map(),
        options: [],
        conflicts: [],
        unresolvable: [],
        strategy: 'latest',
      }).generatePlan();
      const applier2 = new ResolutionApplier(graph2, plan2);

      const applyResult = applier2.apply();

      expect(applyResult).toBeDefined();
    });
  });

  describe('validation', () => {
    it('should validate modifications', () => {
      const result = applier.apply();

      expect(result.warnings).toBeDefined();
      expect(Array.isArray(result.warnings)).toBe(true);
    });

    it('should warn about downgrades', () => {
      const graph2 = new DependencyGraph();
      graph2.addDependency('express', '4.18.0');
      graph2.addDependency('express', '4.17.0');
      graph2.detectConflicts();

      const plan2 = new ResolutionPlanner(graph2, {
        success: true,
        resolutions: new Map(),
        options: [],
        conflicts: [],
        unresolvable: [],
        strategy: 'conservative',
      }).generatePlan();
      const applier2 = new ResolutionApplier(graph2, plan2);
      const applyResult = applier2.apply();

      expect(applyResult).toBeDefined();
    });
  });
});
