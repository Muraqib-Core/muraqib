import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OSVClient, type OSVVulnerability } from "../../../../src/scanners/dependency/osv-client.js";

describe("OSVClient", () => {
  let client: OSVClient;

  beforeEach(() => {
    client = new OSVClient();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("query()", () => {
    it("should query OSV API successfully", async () => {
      const mockVuln: OSVVulnerability = {
        id: "GHSA-1234-5678-9abc",
        published: "2023-01-01T00:00:00Z",
        modified: "2023-01-02T00:00:00Z",
        aliases: ["CVE-2023-0001"],
        related: [],
        summary: "Critical vulnerability in package",
        affected: [
          {
            package: {
              ecosystem: "npm",
              name: "example-pkg",
            },
            ranges: [
              {
                type: "SEMVER",
                events: [{ introduced: "0.0.0" }, { fixed: "1.2.3" }],
              },
            ],
          },
        ],
        references: [
          {
            type: "ADVISORY",
            url: "https://example.com/advisory",
          },
        ],
        severity: [{ type: "CVSS_V3", score: "9.8" }],
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ vulns: [mockVuln] }),
      });

      const result = await client.query({
        package: {
          ecosystem: "npm",
          name: "example-pkg",
        },
        version: "1.0.0",
      });

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("GHSA-1234-5678-9abc");
      expect(result[0].summary).toBe("Critical vulnerability in package");
    });

    it("should handle empty vulnerability response", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ vulns: [] }),
      });

      const result = await client.query({
        package: {
          ecosystem: "npm",
          name: "safe-pkg",
        },
      });

      expect(result).toHaveLength(0);
    });

    it("should handle API errors gracefully", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      });

      await expect(
        client.query({
          package: {
            ecosystem: "npm",
            name: "error-pkg",
          },
        })
      ).rejects.toThrow("OSV API error: 500 Internal Server Error");
    });

    it("should handle timeout errors", async () => {
      global.fetch = vi.fn().mockImplementation(() => {
        const error = new Error("Aborted");
        error.name = "AbortError";
        throw error;
      });

      await expect(
        client.query({
          package: {
            ecosystem: "npm",
            name: "timeout-pkg",
          },
        })
      ).rejects.toThrow("OSV API timeout");
    });

    it("should handle network errors", async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

      await expect(
        client.query({
          package: {
            ecosystem: "npm",
            name: "network-error-pkg",
          },
        })
      ).rejects.toThrow("Network error");
    });
  });

  describe("queryBatch()", () => {
    it("should query multiple packages", async () => {
      const mockVuln: OSVVulnerability = {
        id: "GHSA-1234-5678-9abc",
        published: "2023-01-01T00:00:00Z",
        modified: "2023-01-02T00:00:00Z",
        aliases: [],
        related: [],
        summary: "Test vulnerability",
        affected: [],
        references: [],
        severity: [],
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ vulns: [mockVuln] }),
      });

      const requests = [
        { package: { ecosystem: "npm", name: "pkg1" }, version: "1.0.0" },
        { package: { ecosystem: "npm", name: "pkg2" }, version: "2.0.0" },
      ];

      const results = await client.queryBatch(requests);

      expect(results.size).toBe(2);
      expect(results.has("pkg1@1.0.0")).toBe(true);
      expect(results.has("pkg2@2.0.0")).toBe(true);
    });

    it("should handle individual query failures", async () => {
      let callCount = 0;
      global.fetch = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ vulns: [] }),
          });
        }
        return Promise.resolve({
          ok: false,
          status: 500,
          statusText: "Server Error",
        });
      });

      const requests = [
        { package: { ecosystem: "npm", name: "pkg1" } },
        { package: { ecosystem: "npm", name: "pkg2" } },
      ];

      const results = await client.queryBatch(requests);

      expect(results.size).toBe(2);
      expect(results.get("pkg1@*")).toEqual([]);
      expect(results.get("pkg2@*")).toEqual([]);
    });
  });

  describe("isCritical()", () => {
    it("should identify critical vulnerabilities", () => {
      const vuln: OSVVulnerability = {
        id: "CVE-2023-0001",
        published: "2023-01-01T00:00:00Z",
        modified: "2023-01-02T00:00:00Z",
        aliases: [],
        related: [],
        summary: "Critical vulnerability",
        affected: [],
        references: [],
        severity: [{ type: "CVSS_V3", score: "9.5" }],
      };

      expect(client.isCritical(vuln)).toBe(true);
    });

    it("should not mark high severity as critical", () => {
      const vuln: OSVVulnerability = {
        id: "CVE-2023-0001",
        published: "2023-01-01T00:00:00Z",
        modified: "2023-01-02T00:00:00Z",
        aliases: [],
        related: [],
        summary: "High severity vulnerability",
        affected: [],
        references: [],
        severity: [{ type: "CVSS_V3", score: "8.5" }],
      };

      expect(client.isCritical(vuln)).toBe(false);
    });

    it("should handle missing severity", () => {
      const vuln: OSVVulnerability = {
        id: "CVE-2023-0001",
        published: "2023-01-01T00:00:00Z",
        modified: "2023-01-02T00:00:00Z",
        aliases: [],
        related: [],
        summary: "Vulnerability with no severity",
        affected: [],
        references: [],
      };

      expect(client.isCritical(vuln)).toBe(false);
    });
  });

  describe("isHighSeverity()", () => {
    it("should identify high severity vulnerabilities", () => {
      const vuln: OSVVulnerability = {
        id: "CVE-2023-0001",
        published: "2023-01-01T00:00:00Z",
        modified: "2023-01-02T00:00:00Z",
        aliases: [],
        related: [],
        summary: "High severity vulnerability",
        affected: [],
        references: [],
        severity: [{ type: "CVSS_V3", score: "7.5" }],
      };

      expect(client.isHighSeverity(vuln)).toBe(true);
    });

    it("should not mark critical as high severity", () => {
      const vuln: OSVVulnerability = {
        id: "CVE-2023-0001",
        published: "2023-01-01T00:00:00Z",
        modified: "2023-01-02T00:00:00Z",
        aliases: [],
        related: [],
        summary: "Critical vulnerability",
        affected: [],
        references: [],
        severity: [{ type: "CVSS_V3", score: "9.5" }],
      };

      expect(client.isHighSeverity(vuln)).toBe(true);
    });

    it("should mark severity below 7.0 as not high", () => {
      const vuln: OSVVulnerability = {
        id: "CVE-2023-0001",
        published: "2023-01-01T00:00:00Z",
        modified: "2023-01-02T00:00:00Z",
        aliases: [],
        related: [],
        summary: "Medium severity vulnerability",
        affected: [],
        references: [],
        severity: [{ type: "CVSS_V3", score: "6.5" }],
      };

      expect(client.isHighSeverity(vuln)).toBe(false);
    });
  });
});
