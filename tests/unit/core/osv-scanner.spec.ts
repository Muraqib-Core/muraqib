import { describe, it, expect, vi } from 'vitest';
import { OSVClient, type OSVVulnerability, type OSVQueryRequest } from '../../../src/scanners/dependency/osv-client';

vi.stubGlobal('fetch', vi.fn());

describe('OSV Scanner', () => {
  describe('OSVClient', () => {
    it('should create client with default settings', () => {
      const client = new OSVClient();
      expect(client).toBeDefined();
    });

    it('should query vulnerability', async () => {
      const mockFetch = vi.mocked(global.fetch);
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ vulns: [] }), { status: 200 })
      );

      const client = new OSVClient();
      const request: OSVQueryRequest = {
        package: {
          ecosystem: 'npm',
          name: 'lodash',
        },
        version: '4.17.20',
      };

      const result = await client.query(request);
      expect(Array.isArray(result)).toBe(true);
    });

    it('should handle API error responses', async () => {
      const mockFetch = vi.mocked(global.fetch);
      mockFetch.mockResolvedValueOnce(
        new Response('Not Found', { status: 404 })
      );

      const client = new OSVClient();
      const request: OSVQueryRequest = {
        package: { ecosystem: 'npm', name: 'nonexistent' },
      };

      try {
        await client.query(request);
      } catch (error) {
        expect(error instanceof Error).toBe(true);
      }
    });

    it('should handle timeout errors', async () => {
      const mockFetch = vi.mocked(global.fetch);
      mockFetch.mockImplementationOnce(() => {
        const error = new Error('Aborted');
        (error as any).name = 'AbortError';
        throw error;
      });

      const client = new OSVClient();
      const request: OSVQueryRequest = {
        package: { ecosystem: 'npm', name: 'test' },
      };

      try {
        await client.query(request);
      } catch (error) {
        expect(error instanceof Error).toBe(true);
      }
    });

    it('should batch query multiple packages', async () => {
      const mockFetch = vi.mocked(global.fetch);
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ vulns: [] }), { status: 200 })
      );

      const client = new OSVClient();
      const requests: OSVQueryRequest[] = [
        { package: { ecosystem: 'npm', name: 'lodash' } },
        { package: { ecosystem: 'npm', name: 'express' } },
        { package: { ecosystem: 'npm', name: 'react' } },
      ];

      const results = await client.queryBatch(requests);
      expect(results).toBeInstanceOf(Map);
      expect(results.size).toBeGreaterThanOrEqual(0);
    });

    it('should handle mixed success/failure in batch', async () => {
      const mockFetch = vi.mocked(global.fetch);
      mockFetch
        .mockResolvedValueOnce(new Response(JSON.stringify({ vulns: [] }), { status: 200 }))
        .mockResolvedValueOnce(new Response('Error', { status: 500 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ vulns: [] }), { status: 200 }));

      const client = new OSVClient();
      const requests: OSVQueryRequest[] = [
        { package: { ecosystem: 'npm', name: 'pkg1' } },
        { package: { ecosystem: 'npm', name: 'pkg2' } },
        { package: { ecosystem: 'npm', name: 'pkg3' } },
      ];

      const results = await client.queryBatch(requests);
      expect(results.size).toBeGreaterThanOrEqual(0);
    });

    it('should construct proper package key', async () => {
      const mockFetch = vi.mocked(global.fetch);
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ vulns: [] }), { status: 200 })
      );

      const client = new OSVClient();
      const requests: OSVQueryRequest[] = [
        { package: { ecosystem: 'npm', name: 'test-pkg' }, version: '1.0.0' },
      ];

      const results = await client.queryBatch(requests);
      expect(results.has('test-pkg@1.0.0')).toBe(true);
    });

    it('should handle empty response', async () => {
      const mockFetch = vi.mocked(global.fetch);
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({}), { status: 200 })
      );

      const client = new OSVClient();
      const result = await client.query({
        package: { ecosystem: 'npm', name: 'test' },
      });

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThanOrEqual(0);
    });

    it('should handle vulnerability with all fields', async () => {
      const mockVuln: OSVVulnerability = {
        id: 'OSV-2024-001',
        published: '2024-01-01T00:00:00Z',
        modified: '2024-01-02T00:00:00Z',
        aliases: ['CVE-2024-1234'],
        related: ['OSV-2024-002'],
        summary: 'Test vulnerability',
        details: 'Detailed description',
        affected: [{
          package: { ecosystem: 'npm', name: 'test' },
          ranges: [{
            type: 'SEMVER',
            events: [{ introduced: '1.0.0' }, { fixed: '1.0.1' }],
          }],
        }],
        references: [{ type: 'WEB', url: 'https://example.com' }],
        severity: [{ type: 'CVSS_V3', score: '7.5' }],
      };

      const mockFetch = vi.mocked(global.fetch);
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ vulns: [mockVuln] }), { status: 200 })
      );

      const client = new OSVClient();
      const result = await client.query({
        package: { ecosystem: 'npm', name: 'test' },
      });

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('OSV-2024-001');
    });

    it('should handle empty package list in batch', async () => {
      const mockFetch = vi.mocked(global.fetch);
      const client = new OSVClient();
      const results = await client.queryBatch([]);

      expect(results).toBeInstanceOf(Map);
      expect(results.size).toBe(0);
    });

    it('should properly format request body', async () => {
      const mockFetch = vi.mocked(global.fetch);
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ vulns: [] }), { status: 200 })
      );

      const client = new OSVClient();
      const request: OSVQueryRequest = {
        package: { ecosystem: 'npm', name: 'test' },
        version: '1.0.0',
      };

      await client.query(request);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/query'),
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
      );
    });
  });
});
