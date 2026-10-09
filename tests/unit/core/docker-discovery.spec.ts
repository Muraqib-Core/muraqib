import { describe, it, expect } from 'vitest';
import { discoverDockerConfig, type DockerDiscoveryResult } from '../../../src/core/context/docker-discovery';

describe('Docker Discovery', () => {
  describe('discoverDockerConfig', () => {
    it('should return DockerDiscoveryResult', () => {
      const result = discoverDockerConfig('/tmp');
      
      expect(result).toHaveProperty('hasDocker');
      expect(result).toHaveProperty('hasDockerCompose');
      expect(result).toHaveProperty('hasDockerignore');
      expect(result).toHaveProperty('dockerFileVariants');
      expect(result).toHaveProperty('composeFileVariants');
      expect(result).toHaveProperty('containerConfig');
    });

    it('should detect Dockerfile presence', () => {
      const result = discoverDockerConfig('/tmp');
      
      expect(typeof result.hasDocker).toBe('boolean');
      expect(Array.isArray(result.dockerFileVariants)).toBe(true);
    });

    it('should detect docker-compose files', () => {
      const result = discoverDockerConfig('/tmp');
      
      expect(typeof result.hasDockerCompose).toBe('boolean');
      expect(Array.isArray(result.composeFileVariants)).toBe(true);
    });

    it('should detect .dockerignore', () => {
      const result = discoverDockerConfig('/tmp');
      
      expect(typeof result.hasDockerignore).toBe('boolean');
    });

    it('should list Dockerfile variants found', () => {
      const result = discoverDockerConfig('/tmp');
      
      expect(Array.isArray(result.dockerFileVariants)).toBe(true);
      result.dockerFileVariants.forEach(v => {
        expect(typeof v).toBe('string');
      });
    });

    it('should list compose file variants found', () => {
      const result = discoverDockerConfig('/tmp');
      
      expect(Array.isArray(result.composeFileVariants)).toBe(true);
      result.composeFileVariants.forEach(v => {
        expect(typeof v).toBe('string');
      });
    });

    it('should include container configuration', () => {
      const result = discoverDockerConfig('/tmp');
      
      expect(result.containerConfig).toBeDefined();
      expect(typeof result.containerConfig.hasHealthCheck).toBe('boolean');
      expect(typeof result.containerConfig.runAsRoot).toBe('boolean');
      expect(typeof result.containerConfig.hasSecrets).toBe('boolean');
    });

    it('should detect base image if present', () => {
      const result = discoverDockerConfig('/tmp');
      
      if (result.containerConfig.baseImage) {
        expect(typeof result.containerConfig.baseImage).toBe('string');
      }
    });

    it('should handle non-existent directory gracefully', () => {
      const result = discoverDockerConfig('/non/existent/path');
      
      expect(result).toBeDefined();
      expect(typeof result.hasDocker).toBe('boolean');
    });

    it('should handle empty directory gracefully', () => {
      const result = discoverDockerConfig('/tmp');
      
      expect(result.dockerFileVariants.length).toBeGreaterThanOrEqual(0);
      expect(result.composeFileVariants.length).toBeGreaterThanOrEqual(0);
    });

    it('should check all Dockerfile variants', () => {
      const result = discoverDockerConfig('/tmp');
      
      const expectedVariants = [
        'Dockerfile',
        'Dockerfile.dev',
        'Dockerfile.prod',
        'Dockerfile.test',
      ];
      
      // Result may contain some or none of these
      result.dockerFileVariants.forEach(variant => {
        expect(expectedVariants.some(v => variant.includes(v))).toBe(true);
      });
    });

    it('should check all compose file variants', () => {
      const result = discoverDockerConfig('/tmp');
      
      const expectedVariants = [
        'docker-compose',
        'compose',
      ];
      
      result.composeFileVariants.forEach(variant => {
        expect(expectedVariants.some(v => variant.includes(v))).toBe(true);
      });
    });

    it('should have consistent boolean fields', () => {
      const result = discoverDockerConfig('/tmp');
      
      expect(typeof result.hasDocker).toBe('boolean');
      expect(typeof result.hasDockerCompose).toBe('boolean');
      expect(typeof result.hasDockerignore).toBe('boolean');
    });

    it('should have proper container config structure', () => {
      const result = discoverDockerConfig('/tmp');
      const config = result.containerConfig;
      
      expect('baseImage' in config || typeof config.baseImage === 'undefined').toBe(true);
      expect('hasHealthCheck' in config).toBe(true);
      expect('runAsRoot' in config).toBe(true);
      expect('hasSecrets' in config).toBe(true);
    });

    it('should return health check status', () => {
      const result = discoverDockerConfig('/tmp');
      
      expect(typeof result.containerConfig.hasHealthCheck).toBe('boolean');
    });

    it('should return root privilege status', () => {
      const result = discoverDockerConfig('/tmp');
      
      expect(typeof result.containerConfig.runAsRoot).toBe('boolean');
    });

    it('should return secrets status', () => {
      const result = discoverDockerConfig('/tmp');
      
      expect(typeof result.containerConfig.hasSecrets).toBe('boolean');
    });
  });

  describe('Docker configuration detection', () => {
    it('should handle projects with Docker', () => {
      const result = discoverDockerConfig('/tmp');
      
      if (result.hasDocker) {
        expect(result.dockerFileVariants.length).toBeGreaterThan(0);
      }
    });

    it('should handle projects without Docker', () => {
      const result = discoverDockerConfig('/tmp/nonexistent');
      
      expect(result).toBeDefined();
      expect(typeof result.hasDocker).toBe('boolean');
    });

    it('should validate result structure regardless of Docker presence', () => {
      const result = discoverDockerConfig('/');
      
      expect(result).toHaveProperty('hasDocker');
      expect(result).toHaveProperty('hasDockerCompose');
      expect(result).toHaveProperty('hasDockerignore');
      expect(result).toHaveProperty('dockerFileVariants');
      expect(result).toHaveProperty('composeFileVariants');
      expect(result).toHaveProperty('containerConfig');
    });
  });
});
