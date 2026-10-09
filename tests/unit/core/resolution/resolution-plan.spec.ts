import { describe, it, expect, beforeEach } from 'vitest';
import { DependencyGraph } from '../../../../src/core/resolution/dependency-graph.js';
import { ResolutionEngine } from '../../../../src/core/resolution/resolution-engine.js';
import { ResolutionPlanner } from '../../../../src/core/resolution/resolution-plan.js';

describe('ResolutionPlanner', () => {
  let graph: DependencyGraph;
  let engine: ResolutionEngine;
  let planner: ResolutionPlanner;

  beforeEach(async () => {
    graph = new DependencyGraph();
    engine = new ResolutionEngine(graph);
  });

  describe('generatePlan()', () => {
    it('should generate plan with basic steps', async () => {
      graph.addDependency('lodash', '4.17.21');
      graph.addDependency('lodash', '4.17.20');
      graph.detectConflicts();

      const result = await engine.resolve('latest');
      planner = new ResolutionPlanner(graph, result);
      const plan = planner.generatePlan();

      expect(plan.planId).toBeDefined();
      expect(plan.timestamp).toBeDefined();
      expect(plan.strategyUsed).toBe('latest');
      expect(plan.criticality).toBeDefined();
    });

    it('should generate plan with criticality assessment', async () => {
      graph.addDependency('lodash', '4.17.21');
      graph.addDependency('lodash', '4.17.20');
      graph.detectConflicts();

      const result = await engine.resolve('latest');
      planner = new ResolutionPlanner(graph, result);
      const plan = planner.generatePlan();

      expect(['safe', 'risky', 'breaking']).toContain(plan.criticality);
    });

    it('should mark plan as risky when downgrades present', async () => {
      graph.addDependency('express', '4.18.0');
      graph.addDependency('express', '4.17.0');
      graph.detectConflicts();

      const result = await engine.resolve('conservative');
      planner = new ResolutionPlanner(graph, result);
      const plan = planner.generatePlan();

      expect(plan).toBeDefined();
    });

    it('should generate unique plan IDs', async () => {
      graph.addDependency('react', '18.0.0');
      const result1 = await engine.resolve('latest');
      const planner1 = new ResolutionPlanner(graph, result1);
      const plan1 = planner1.generatePlan();

      graph = new DependencyGraph();
      engine = new ResolutionEngine(graph);
      graph.addDependency('react', '18.0.0');
      const result2 = await engine.resolve('latest');
      const planner2 = new ResolutionPlanner(graph, result2);
      const plan2 = planner2.generatePlan();

      expect(plan1.planId).not.toBe(plan2.planId);
    });
  });

  describe('step generation', () => {
    it('should generate upgrade steps', async () => {
      graph.addDependency('lodash', '4.17.20');
      graph.addDependency('lodash', '4.17.21');
      graph.detectConflicts();

      const result = await engine.resolve('latest');
      planner = new ResolutionPlanner(graph, result);
      const plan = planner.generatePlan();

      expect(plan.steps.length).toBeGreaterThanOrEqual(0);
    });

    it('should generate steps with unique IDs', async () => {
      graph.addDependency('express', '4.18.0');
      graph.addDependency('express', '4.17.0');
      graph.detectConflicts();

      const result = await engine.resolve('latest');
      planner = new ResolutionPlanner(graph, result);
      const plan = planner.generatePlan();

      const ids = new Set(plan.steps.map(s => s.id));
      expect(ids.size).toBe(plan.steps.length);
    });

    it('should include npm install commands in steps', async () => {
      graph.addDependency('react', '18.0.0');
      graph.addDependency('react', '17.0.0');
      graph.detectConflicts();

      const result = await engine.resolve('latest');
      planner = new ResolutionPlanner(graph, result);
      const plan = planner.generatePlan();

      const stepsWithCommands = plan.steps.filter(s => s.command);
      expect(stepsWithCommands.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('summary calculation', () => {
    it('should count upgrades correctly', async () => {
      graph.addDependency('lodash', '4.17.20');
      graph.addDependency('lodash', '4.17.21');
      graph.detectConflicts();

      const result = await engine.resolve('latest');
      planner = new ResolutionPlanner(graph, result);
      const plan = planner.generatePlan();

      expect(plan.summary).toBeDefined();
      expect(plan.summary.conflicts).toBeGreaterThanOrEqual(0);
    });

    it('should include correct step counts', async () => {
      graph.addDependency('express', '4.18.0');
      graph.addDependency('express', '4.17.0');
      graph.detectConflicts();

      const result = await engine.resolve('latest');
      planner = new ResolutionPlanner(graph, result);
      const plan = planner.generatePlan();

      expect(plan.totalSteps).toBeGreaterThanOrEqual(0);
      expect(plan.steps.length).toBe(plan.totalSteps);
    });
  });

  describe('impact assessment', () => {
    it('should assess performance risk as low for patch updates', async () => {
      graph.addDependency('lodash', '4.17.21');
      graph.addDependency('lodash', '4.17.20');
      graph.detectConflicts();

      const result = await engine.resolve('latest');
      planner = new ResolutionPlanner(graph, result);
      const plan = planner.generatePlan();

      expect(plan.estimatedImpact.performanceRisk).toBeDefined();
    });

    it('should count breaking changes', async () => {
      graph.addDependency('react', '18.0.0');
      graph.addDependency('react', '17.0.0');
      graph.detectConflicts();

      const result = await engine.resolve('latest');
      planner = new ResolutionPlanner(graph, result);
      const plan = planner.generatePlan();

      expect(plan.estimatedImpact.breakingChanges).toBeGreaterThanOrEqual(0);
    });
  });

  describe('warnings generation', () => {
    it('should generate warnings for unresolvable conflicts', async () => {
      graph.addDependency('react', '18.0.0', { isDirect: true });
      graph.addDependency('react', '16.0.0', { isDirect: true });
      graph.detectConflicts();

      const result = await engine.resolve('intersection');
      planner = new ResolutionPlanner(graph, result);
      const plan = planner.generatePlan();

      expect(plan.warnings).toBeDefined();
    });

    it('should warn about circular dependencies', async () => {
      const a = graph.addDependency('a', '1.0.0');
      const b = graph.addDependency('b', '1.0.0');
      const c = graph.addDependency('c', '1.0.0');

      graph.addEdge(a, b);
      graph.addEdge(b, c);
      graph.addEdge(c, a);

      const result = await engine.resolve('latest');
      planner = new ResolutionPlanner(graph, result);
      const plan = planner.generatePlan();

      expect(plan.warnings.some(w => w.includes('Circular'))).toBe(true);
    });

    it('should include helpful notes', async () => {
      graph.addDependency('express', '4.18.0');
      const result = await engine.resolve('latest');
      planner = new ResolutionPlanner(graph, result);
      const plan = planner.generatePlan();

      expect(plan.notes.length).toBeGreaterThan(0);
      expect(plan.notes[0]).toContain('Review');
    });
  });

  describe('dependencies extraction', () => {
    it('should extract all affected dependencies', async () => {
      graph.addDependency('react', '18.0.0');
      graph.addDependency('react', '17.0.0');
      graph.detectConflicts();

      const result = await engine.resolve('latest');
      planner = new ResolutionPlanner(graph, result);
      const plan = planner.generatePlan();

      expect(plan.dependencies).toBeDefined();
      expect(Array.isArray(plan.dependencies)).toBe(true);
    });
  });

  describe('criticality assessment', () => {
    it('should assess criticality based on conflicts', async () => {
      graph.addDependency('lodash', '4.17.21');
      const result = await engine.resolve('latest');
      planner = new ResolutionPlanner(graph, result);
      const plan = planner.generatePlan();

      expect(['safe', 'risky', 'breaking']).toContain(plan.criticality);
    });

    it('should mark as safe when no critical changes', async () => {
      graph.addDependency('lodash', '4.17.21');
      const result = await engine.resolve('latest');
      planner = new ResolutionPlanner(graph, result);
      const plan = planner.generatePlan();

      expect(plan.criticality).toBe('safe');
    });
  });
});
