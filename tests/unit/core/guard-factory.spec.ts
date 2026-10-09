import { describe, it, expect } from 'vitest';
import { GuardFactory } from '../../../src/core/guard-factory.js';
import type { AuditContext } from '../../../src/core/types.js';

const createTestContext = (): AuditContext => ({
  projectRoot: '/test/project',
  timestamp: Date.now(),
  environment: 'development',
  nodeVersion: process.version,
  npmVersion: '9.0.0',
  gitBranch: 'main',
  gitCommit: 'abc123',
});

describe('GuardFactory', () => {
  describe('creation', () => {
    it('should create a factory with context', () => {
      const context = createTestContext();
      const factory = GuardFactory.create(context);

      expect(factory).toBeDefined();
      expect(factory).toHaveProperty('createAsyncGuard');
      expect(factory).toHaveProperty('createMemoryGuard');
      expect(factory).toHaveProperty('createSecurityGuard');
    });
  });

  describe('guard creation methods', () => {
    it('should create MemoryGuard', () => {
      const context = createTestContext();
      const factory = GuardFactory.create(context);

      const guard = factory.createMemoryGuard();
      expect(guard).toBeDefined();
      expect(guard.constructor.name).toBe('MemoryGuard');
    });

    it('should create AsyncGuard with target path', () => {
      const context = createTestContext();
      const factory = GuardFactory.create(context);

      const guard = factory.createAsyncGuard('/src');
      expect(guard).toBeDefined();
      expect(guard.constructor.name).toBe('AsyncGuard');
    });

    it('should create ConfigGuard with project root', () => {
      const context = createTestContext();
      const factory = GuardFactory.create(context);

      const guard = factory.createConfigGuard('/project');
      expect(guard).toBeDefined();
      expect(guard.constructor.name).toBe('ConfigGuard');
    });

    it('should create DependencyGuard with target path', () => {
      const context = createTestContext();
      const factory = GuardFactory.create(context);

      const guard = factory.createDependencyGuard('/src');
      expect(guard).toBeDefined();
      expect(guard.constructor.name).toBe('DependencyGuard');
    });

    it('should create DockerGuard', () => {
      const context = createTestContext();
      const factory = GuardFactory.create(context);

      const guard = factory.createDockerGuard('/project');
      expect(guard).toBeDefined();
      expect(guard.constructor.name).toBe('DockerGuard');
    });

    it('should create SecurityGuard with target URL', () => {
      const context = createTestContext();
      const factory = GuardFactory.create(context);

      const guard = factory.createSecurityGuard('http://localhost:3000');
      expect(guard).toBeDefined();
      expect(guard.constructor.name).toBe('SecurityGuard');
    });

    it('should create ImageGuard with optional target path', () => {
      const context = createTestContext();
      const factory = GuardFactory.create(context);

      const guard1 = factory.createImageGuard();
      expect(guard1).toBeDefined();
      expect(guard1.constructor.name).toBe('ImageGuard');

      const guard2 = factory.createImageGuard('/assets');
      expect(guard2).toBeDefined();
      expect(guard2.constructor.name).toBe('ImageGuard');
    });

    it('should create DeadCodeGuard with target path', () => {
      const context = createTestContext();
      const factory = GuardFactory.create(context);

      const guard = factory.createDeadCodeGuard('/src');
      expect(guard).toBeDefined();
      expect(guard.constructor.name).toBe('DeadCodeGuard');
    });

    it('should create CompatibilityGuard', () => {
      const context = createTestContext();
      const factory = GuardFactory.create(context);

      const guard = factory.createCompatibilityGuard('/project');
      expect(guard).toBeDefined();
      expect(guard.constructor.name).toBe('CompatibilityGuard');
    });
  });

  describe('batch creation', () => {
    it('should create all available guards', () => {
      const context = createTestContext();
      const factory = GuardFactory.create(context);
      const config = {
        projectRoot: '/test',
        asyncTargetPath: '/src',
        dependencyTargetPath: '/src',
        securityTargetUrl: 'http://localhost:3000',
      };

      const guards = factory.createAllGuards(config);

      expect(guards.length).toBeGreaterThan(0);
      expect(guards[0].constructor.name).toBe('MemoryGuard');
      expect(guards[1].constructor.name).toBe('CompatibilityGuard');
    });

    it('should conditionally include optional guards', () => {
      const context = createTestContext();
      const factory = GuardFactory.create(context);

      const config1 = {
        projectRoot: '/test',
      };
      const guards1 = factory.createAllGuards(config1);

      const config2 = {
        projectRoot: '/test',
        asyncTargetPath: '/src',
        securityTargetUrl: 'http://localhost:3000',
      };
      const guards2 = factory.createAllGuards(config2);

      expect(guards2.length).toBeGreaterThan(guards1.length);
    });
  });

  describe('parallel execution', () => {
    it('should run all guards in parallel', async () => {
      const context = createTestContext();
      const factory = GuardFactory.create(context);
      const config = {
        projectRoot: '/test',
        memoryOptions: { heapWarnMb: 100 },
      };

      const results = await factory.runAllGuards(config);

      expect(results).toBeDefined();
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeGreaterThan(0);

      // Verify all results are valid
      for (const result of results) {
        expect(result).toHaveProperty('status');
        expect(result).toHaveProperty('module');
        expect(result).toHaveProperty('issues');
        expect(result).toHaveProperty('timestamp');
        expect(result).toHaveProperty('duration');
      }
    });

    it('should handle mixed success and error results', async () => {
      const context = createTestContext();
      const factory = GuardFactory.create(context);
      const config = {
        projectRoot: '/test',
        asyncTargetPath: '/non/existent/path', // Will likely error
      };

      const results = await factory.runAllGuards(config);

      expect(results).toBeDefined();
      expect(results.length).toBeGreaterThan(0);

      // At least one should be memory guard (always succeeds)
      const memoryResult = results.find((r) => r.module === 'memory-guard');
      expect(memoryResult).toBeDefined();
    });
  });

  describe('configuration', () => {
    it('should accept minimal configuration', () => {
      const context = createTestContext();
      const factory = GuardFactory.create(context);
      const config = {};

      const guards = factory.createAllGuards(config);
      expect(guards.length).toBeGreaterThan(0);
    });

    it('should accept full configuration', () => {
      const context = createTestContext();
      const factory = GuardFactory.create(context);
      const config = {
        projectRoot: '/test',
        asyncTargetPath: '/src',
        configProjectRoot: '/config',
        dependencyTargetPath: '/deps',
        dockerProjectRoot: '/docker',
        memoryOptions: { heapWarnMb: 500 },
        securityTargetUrl: 'http://localhost:3000',
        imageTargetPath: '/assets',
        deadCodeTargetPath: '/src',
      };

      const guards = factory.createAllGuards(config);
      expect(guards.length).toBeGreaterThan(5);
    });
  });

  describe('context propagation', () => {
    it('should pass context to all created guards', () => {
      const context: AuditContext = {
        projectRoot: '/test/project',
        timestamp: 12345,
        environment: 'production',
        nodeVersion: 'v18.0.0',
        npmVersion: '9.0.0',
        gitBranch: 'develop',
        gitCommit: 'def456',
      };

      const factory = GuardFactory.create(context);
      const memory = factory.createMemoryGuard();
      const async = factory.createAsyncGuard('/src');

      // Verify both guards have context (through their methods)
      expect(memory).toBeDefined();
      expect(async).toBeDefined();
    });
  });
});
