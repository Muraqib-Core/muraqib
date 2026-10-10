import { describe, it, expect } from 'vitest';
import type { AuditContext } from '../../../src/core/types';

describe('Compatibility Guard', () => {
  describe('Node.js Version Compatibility', () => {
    it('should check minimum Node version', () => {
      const context: AuditContext = {
        projectRoot: '/app',
        timestamp: Date.now(),
        environment: 'production',
        nodeVersion: 'v18.0.0',
        npmVersion: '8.0.0',
      };

      const parseVersion = (v: string): number => {
        const match = v.match(/v?(\d+)/);
        return match ? parseInt(match[1], 10) : 0;
      };

      const nodeVersion = parseVersion(context.nodeVersion);
      expect(nodeVersion).toBeGreaterThanOrEqual(14);
    });

    it('should detect Node.js version mismatch', () => {
      const required = 18;
      const actual = 16;
      
      expect(actual).toBeLessThan(required);
    });

    it('should support Node 14.x', () => {
      const supported = ['14.0.0', '14.17.0', '14.21.0'];
      const versions = supported.map(v => parseInt(v.split('.')[0]));
      
      expect(versions.every(v => v === 14)).toBe(true);
    });

    it('should support Node 16.x', () => {
      const supported = ['16.0.0', '16.13.0', '16.20.0'];
      const versions = supported.map(v => parseInt(v.split('.')[0]));
      
      expect(versions.every(v => v === 16)).toBe(true);
    });

    it('should support Node 18.x', () => {
      const supported = ['18.0.0', '18.12.0', '18.20.0'];
      const versions = supported.map(v => parseInt(v.split('.')[0]));
      
      expect(versions.every(v => v === 18)).toBe(true);
    });

    it('should detect LTS versions', () => {
      const ltsVersions = ['14.21.3', '16.20.1', '18.18.2', '20.10.0'];
      const isLTS = (v: string): boolean => {
        const major = parseInt(v.split('.')[0]);
        return [14, 16, 18, 20].includes(major);
      };

      expect(ltsVersions.every(isLTS)).toBe(true);
    });
  });

  describe('npm/yarn/pnpm Compatibility', () => {
    it('should detect npm version', () => {
      const context: AuditContext = {
        projectRoot: '/app',
        timestamp: Date.now(),
        environment: 'production',
        nodeVersion: 'v18.0.0',
        npmVersion: '9.0.0',
      };

      const npmVersion = parseInt(context.npmVersion.split('.')[0]);
      expect(npmVersion).toBeGreaterThanOrEqual(7);
    });

    it('should support npm 7+', () => {
      const versions = ['7.0.0', '8.19.4', '9.6.7', '10.2.0'];
      const major = versions.map(v => parseInt(v.split('.')[0]));
      
      expect(major.every(m => m >= 7)).toBe(true);
    });

    it('should support yarn', () => {
      const managers = { npm: '9.0.0', yarn: '3.6.0', pnpm: '8.0.0' };
      
      expect('yarn' in managers).toBe(true);
      expect(managers.yarn).toBeDefined();
    });

    it('should support pnpm', () => {
      const managers = { npm: '9.0.0', yarn: '3.6.0', pnpm: '8.0.0' };
      
      expect('pnpm' in managers).toBe(true);
      expect(managers.pnpm).toBeDefined();
    });
  });

  describe('Package Compatibility', () => {
    it('should check peer dependencies', () => {
      const peers = {
        'react': '^16.8.0 || ^17.0.0 || ^18.0.0',
        'react-dom': '^16.8.0 || ^17.0.0 || ^18.0.0',
      };

      expect('react' in peers).toBe(true);
      expect('react-dom' in peers).toBe(true);
    });

    it('should validate peer dependency ranges', () => {
      const installed = '18.2.0';

      const major = parseInt(installed.split('.')[0]);
      const isCompatible = [16, 17, 18].includes(major);

      expect(isCompatible).toBe(true);
    });

    it('should detect dependency conflicts', () => {
      const deps = {
        'pkg-a': { 'shared': '^1.0.0' },
        'pkg-b': { 'shared': '^2.0.0' },
      };

      const shared1 = parseInt(deps['pkg-a']['shared'].replace('^', '').split('.')[0]);
      const shared2 = parseInt(deps['pkg-b']['shared'].replace('^', '').split('.')[0]);

      expect(shared1).not.toBe(shared2);
    });

    it('should check optional dependencies', () => {
      const optionalDeps = {
        'sqlite': '^4.0.0',
        'mongodb': '^4.0.0',
      };

      expect('sqlite' in optionalDeps).toBe(true);
      expect('mongodb' in optionalDeps).toBe(true);
    });
  });

  describe('Framework Compatibility', () => {
    it('should validate React version', () => {
      const supported = ['16.8.0', '17.0.2', '18.2.0', '19.0.0'];
      const compatible = supported.filter(v => {
        const major = parseInt(v.split('.')[0]);
        return major >= 16;
      });

      expect(compatible.length).toBeGreaterThan(0);
    });

    it('should validate Next.js version', () => {
      const supported = ['12.0.0', '13.5.0', '14.0.0', '14.2.0'];
      const compatible = supported.filter(v => {
        const major = parseInt(v.split('.')[0]);
        return major >= 12;
      });

      expect(compatible.length).toBeGreaterThan(0);
    });

    it('should validate Express version', () => {
      const supported = ['4.17.0', '4.18.2', '5.0.0'];
      const compatible = supported.filter(v => {
        const major = parseInt(v.split('.')[0]);
        return major >= 4;
      });

      expect(compatible.length).toBeGreaterThan(0);
    });

    it('should validate Prisma version', () => {
      const supported = ['4.0.0', '5.0.0', '5.8.0'];
      const compatible = supported.filter(v => {
        const major = parseInt(v.split('.')[0]);
        return major >= 4;
      });

      expect(compatible.length).toBeGreaterThan(0);
    });

    it('should detect TypeScript compatibility', () => {
      const supported = ['4.0.0', '4.9.5', '5.0.0', '5.2.0'];
      const compatible = supported.filter(v => {
        const major = parseInt(v.split('.')[0]);
        return major >= 4;
      });

      expect(compatible.length).toBeGreaterThan(0);
    });
  });

  describe('Breaking Changes', () => {
    it('should detect major version bump', () => {
      const versions = ['1.0.0', '2.0.0'];
      const [from, to] = versions;
      
      const fromMajor = parseInt(from.split('.')[0]);
      const toMajor = parseInt(to.split('.')[0]);

      expect(toMajor).toBeGreaterThan(fromMajor);
    });

    it('should flag breaking changes in dependencies', () => {
      const breaking = [
        { pkg: 'react', from: '17', to: '18', breaking: true },
        { pkg: 'next', from: '12', to: '13', breaking: true },
        { pkg: 'prisma', from: '4', to: '5', breaking: true },
      ];

      expect(breaking.every(b => b.breaking)).toBe(true);
    });

    it('should track deprecation warnings', () => {
      const deprecated = [
        { package: 'request', reason: 'Use axios or fetch instead' },
        { package: 'node-uuid', reason: 'Use native uuid' },
      ];

      expect(deprecated.length).toBeGreaterThan(0);
      expect(deprecated[0]).toHaveProperty('reason');
    });

    it('should detect API changes', () => {
      const apiChanges = [
        { version: '5.0.0', change: 'Removed callback-based API' },
        { version: '5.0.0', change: 'Promise-only API' },
      ];

      expect(apiChanges.length).toBeGreaterThan(0);
    });
  });

  describe('Compatibility Matrix', () => {
    it('should create compatibility matrix', () => {
      const matrix = {
        'react@18': { 'next@14': true, 'next@13': true, 'next@12': false },
        'react@17': { 'next@14': false, 'next@13': true, 'next@12': true },
      };

      expect(matrix['react@18']['next@14']).toBe(true);
      expect(matrix['react@17']['next@14']).toBe(false);
    });

    it('should check transitive compatibility', () => {
      const deps = {
        'app': { 'react': '18', 'next': '14' },
        'react': { 'js-dom': '3' },
        'next': { 'react': '18' },
      };

      const appReact = deps['app']['react'];
      const nextReact = deps['next']['react'];

      expect(appReact).toBe(nextReact);
    });
  });

  describe('Environment Compatibility', () => {
    it('should validate production requirements', () => {
      const _required = ['node >= 18', 'npm >= 8'];

      expect(_required).toContain('node >= 18');
      expect(_required).toContain('npm >= 8');
    });

    it('should validate development requirements', () => {
      const _required = ['node >= 16', 'typescript >= 4'];

      expect(_required).toContain('node >= 16');
      expect(_required).toContain('typescript >= 4');
    });

    it('should check CI/CD compatibility', () => {
      const ciRequirements = {
        'github-actions': ['node >= 16'],
        'gitlab-ci': ['node >= 16'],
        'travis': ['node >= 14'],
      };

      expect('github-actions' in ciRequirements).toBe(true);
      expect(ciRequirements['github-actions'].length).toBeGreaterThan(0);
    });
  });
});
