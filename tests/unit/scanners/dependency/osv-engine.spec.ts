import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OSVGuard, performOSVScan } from "../../../../src/scanners/dependency/osv-engine.js";
import type { OSVVulnerability } from "../../../../src/scanners/dependency/osv-client.js";

vi.mock("fs");

describe("OSVGuard", () => {
  let guard: OSVGuard;

  beforeEach(() => {
    guard = new OSVGuard({
      projectRoot: "/mock/project",
    });
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("execute()", () => {
    it("should return ok when no dependencies found", async () => {
      const { readFileSync } = await import("fs");
      vi.mocked(readFileSync).mockImplementation(() => {
        throw new Error("ENOENT");
      });

      const result = await guard.execute();

      expect(result.status).toBe("ok");
      expect(result.issues).toHaveLength(0);
      expect(result.message).toContain("No dependencies");
    });

    it("should return ok when no vulnerabilities found", async () => {
      const { readFileSync } = await import("fs");
      vi.mocked(readFileSync).mockImplementation((path) => {
        if (String(path).includes("package.json")) {
          return JSON.stringify({
            dependencies: {
              "safe-pkg": "1.0.0",
            },
          });
        }
        if (String(path).includes("package-lock.json")) {
          return JSON.stringify({
            packages: {
              "node_modules/safe-pkg": {
                version: "1.0.0",
              },
            },
          });
        }
        return "{}";
      });

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({ vulns: [] }),
      });

      const result = await guard.execute();

      expect(result.status).toBe("ok");
      expect(result.issues).toHaveLength(0);
    });

    it("should detect and report vulnerabilities", async () => {
      const { readFileSync } = await import("fs");
      vi.mocked(readFileSync).mockImplementation((path) => {
        if (String(path).includes("package.json")) {
          return JSON.stringify({
            dependencies: {
              "vulnerable-pkg": "1.0.0",
            },
          });
        }
        if (String(path).includes("package-lock.json")) {
          return JSON.stringify({
            packages: {
              "node_modules/vulnerable-pkg": {
                version: "1.0.0",
              },
            },
          });
        }
        return "{}";
      });

      const mockVuln: OSVVulnerability = {
        id: "GHSA-1234-5678-9abc",
        published: "2023-01-01T00:00:00Z",
        modified: "2023-01-02T00:00:00Z",
        aliases: ["CVE-2023-0001"],
        related: [],
        summary: "Critical vulnerability",
        affected: [
          {
            package: {
              ecosystem: "npm",
              name: "vulnerable-pkg",
            },
            ranges: [
              {
                type: "SEMVER",
                events: [{ introduced: "0.0.0" }, { fixed: "2.0.0" }],
              },
            ],
          },
        ],
        references: [],
        severity: [{ type: "CVSS_V3", score: "9.8" }],
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({ vulns: [mockVuln] }),
      });

      const result = await guard.execute();

      expect(result.status).toBe("error");
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].severity).toBe("critical");
      expect(result.issues[0].title).toContain("vulnerable-pkg");
      expect(result.issues[0].recommendation).toContain("2.0.0");
    });

    it("should handle multiple vulnerabilities in single package", async () => {
      const { readFileSync } = await import("fs");
      vi.mocked(readFileSync).mockImplementation((path) => {
        if (String(path).includes("package.json")) {
          return JSON.stringify({
            dependencies: {
              "multi-vuln-pkg": "1.0.0",
            },
          });
        }
        if (String(path).includes("package-lock.json")) {
          return JSON.stringify({
            packages: {
              "node_modules/multi-vuln-pkg": {
                version: "1.0.0",
              },
            },
          });
        }
        return "{}";
      });

      const mockVuln1: OSVVulnerability = {
        id: "GHSA-1111-2222-3333",
        published: "2023-01-01T00:00:00Z",
        modified: "2023-01-02T00:00:00Z",
        aliases: [],
        related: [],
        summary: "Vulnerability 1",
        affected: [],
        references: [],
        severity: [{ type: "CVSS_V3", score: "9.8" }],
      };

      const mockVuln2: OSVVulnerability = {
        id: "GHSA-4444-5555-6666",
        published: "2023-01-01T00:00:00Z",
        modified: "2023-01-02T00:00:00Z",
        aliases: [],
        related: [],
        summary: "Vulnerability 2",
        affected: [],
        references: [],
        severity: [{ type: "CVSS_V3", score: "7.5" }],
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ vulns: [mockVuln1, mockVuln2] }),
      });

      const result = await guard.execute();

      expect(result.status).toBe("error");
      expect(result.issues).toHaveLength(2);
      expect(result.issues[0].severity).toBe("critical");
      expect(result.issues[1].severity).toBe("error");
    });

    it("should skip ignored packages", async () => {
      const guardWithIgnore = new OSVGuard({
        projectRoot: "/mock/project",
        ignorePackages: ["ignored-pkg"],
      });

      const { readFileSync } = await import("fs");
      let callCount = 0;
      vi.mocked(readFileSync).mockImplementation((path) => {
        if (String(path).includes("package.json")) {
          return JSON.stringify({
            dependencies: {
              "ignored-pkg": "1.0.0",
              "normal-pkg": "1.0.0",
            },
          });
        }
        if (String(path).includes("package-lock.json")) {
          return JSON.stringify({
            packages: {
              "node_modules/ignored-pkg": { version: "1.0.0" },
              "node_modules/normal-pkg": { version: "1.0.0" },
            },
          });
        }
        return "{}";
      });

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => {
          callCount++;
          return { vulns: [] };
        },
      });

      await guardWithIgnore.execute();

      expect(callCount).toBe(1);
      const fetchCall = (global.fetch as any).mock.calls[0];
      const body = JSON.parse(fetchCall[1]?.body);
      expect(body.package.name).toBe("normal-pkg");
    });

    it("should handle missing package-lock.json", async () => {
      const { readFileSync } = await import("fs");
      vi.mocked(readFileSync).mockImplementation((path) => {
        if (String(path).includes("package.json")) {
          return JSON.stringify({
            dependencies: {
              "pkg1": "1.0.0",
            },
          });
        }
        throw new Error("ENOENT");
      });

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({ vulns: [] }),
      });

      const result = await guard.execute();

      expect(result.status).toBe("ok");
      const fetchCall = (global.fetch as any).mock.calls[0];
      const body = JSON.parse(fetchCall[1]?.body);
      expect(body.version).toBe("latest");
    });

    it("should handle file read errors gracefully", async () => {
      const { readFileSync } = await import("fs");
      vi.mocked(readFileSync).mockImplementation(() => {
        throw new Error("Permission denied");
      });

      const result = await guard.execute();

      expect(result.status).toBe("ok");
      expect(result.message).toContain("No dependencies");
    });
  });
});

describe("performOSVScan()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it("should be callable as a standalone function", async () => {
    const { readFileSync } = await import("fs");
    vi.mocked(readFileSync).mockImplementation((path) => {
      if (String(path).includes("package.json")) {
        return JSON.stringify({
          dependencies: {
            "test-pkg": "1.0.0",
          },
        });
      }
      if (String(path).includes("package-lock.json")) {
        return JSON.stringify({
          packages: {
            "node_modules/test-pkg": { version: "1.0.0" },
          },
        });
      }
      return "{}";
    });

    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ vulns: [] }),
    });

    const result = await performOSVScan({
      projectRoot: "/mock/project",
    });

    expect(result.status).toBe("ok");
    expect(result.module).toBe("osv-dependency-guard");
  });
});
