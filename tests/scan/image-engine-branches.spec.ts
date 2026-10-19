import { describe, expect, it } from "vitest";
import { DockerImageScanner, parseTrivyReport, type CommandRunner } from "../../src/scan/scanners/docker/image-engine.js";

const IMAGE_ID = `sha256:${"a".repeat(64)}`;

function runner(inspect: string | Error, trivy: string | Error): { run: CommandRunner; calls: string[][] } {
  const calls: string[][] = [];
  const run: CommandRunner = async (command, args) => {
    calls.push([command, ...args]);
    const value = command === "docker" ? inspect : trivy;
    if (value instanceof Error) throw value;
    return value;
  };
  return { run, calls };
}

describe("parseTrivyReport branches", () => {
  it("rejects null, missing and empty results", () => {
    expect(() => parseTrivyReport(null, IMAGE_ID)).toThrow();
    expect(() => parseTrivyReport({}, IMAGE_ID)).toThrow();
    expect(() => parseTrivyReport({ Results: [] }, IMAGE_ID)).toThrow();
  });

  it("skips results without vulnerability arrays and incomplete vulnerabilities", () => {
    const issues = parseTrivyReport(
      {
        Results: [
          null,
          { Target: "t" },
          {
            Target: "t",
            Vulnerabilities: [
              null,
              { PkgName: "p", InstalledVersion: "1" },
              { VulnerabilityID: "CVE-1", InstalledVersion: "1" },
              { VulnerabilityID: "CVE-1", PkgName: "p" },
            ],
          },
        ],
      },
      IMAGE_ID,
    );
    expect(issues).toEqual([]);
  });

  it("maps severities, optional fields, duplicates and non-string labels", () => {
    const vuln = { VulnerabilityID: "CVE-1", PkgName: "pkg", InstalledVersion: "1.0" };
    const issues = parseTrivyReport(
      {
        Results: [
          {
            Target: "os\nline",
            Type: "debian",
            Vulnerabilities: [
              { ...vuln, Severity: "HIGH", FixedVersion: "1.1", SeveritySource: "nvd" },
              { ...vuln, Severity: "HIGH" },
              { ...vuln, VulnerabilityID: "CVE-2", Severity: "bogus" },
              { ...vuln, VulnerabilityID: "CVE-3" },
              { ...vuln, VulnerabilityID: 42 as unknown as string },
            ],
          },
          { Vulnerabilities: [{ ...vuln, VulnerabilityID: "CVE-4", Severity: "low" }] },
        ],
      },
      IMAGE_ID,
      "2026-01-01T00:00:00.000Z",
    );
    expect(issues).toHaveLength(5);
    const first = issues[0];
    expect(first?.level).toBe("high");
    expect(first?.recommendation).toContain("1.1");
    expect(issues[1]?.level).toBe("info");
    expect(issues[1]?.recommendation).toContain("advisory");
    expect(issues[4]?.level).toBe("low");
  });

  it("uses the current time by default", () => {
    const issues = parseTrivyReport(
      { Results: [{ Target: "t", Vulnerabilities: [{ VulnerabilityID: "CVE-1", PkgName: "p", InstalledVersion: "1" }] }] },
      IMAGE_ID,
    );
    expect(issues).toHaveLength(1);
  });
});

describe("DockerImageScanner.scan branches", () => {
  it("rejects invalid references (default runner is never invoked)", async () => {
    const scanner = new DockerImageScanner();
    for (const image of ["", "-x", "a\nb"]) {
      expect((await scanner.scan(image)).status).toBe("failed");
    }
  });

  it("is unavailable when inspect fails or returns a bad digest", async () => {
    const failing = runner(new Error("no docker"), "");
    expect((await new DockerImageScanner(failing.run).scan("img")).status).toBe("unavailable");
    const bad = runner("not-a-digest", "");
    expect((await new DockerImageScanner(bad.run).scan("img")).status).toBe("unavailable");
  });

  it("is unavailable when trivy fails", async () => {
    const r = runner(`${IMAGE_ID}\n`, new Error("no trivy"));
    const result = await new DockerImageScanner(r.run).scan("img");
    expect(result.status).toBe("unavailable");
    expect(result.skippedInputs).toEqual([IMAGE_ID]);
  });

  it("fails on invalid trivy output and succeeds on valid output", async () => {
    expect((await new DockerImageScanner(runner(IMAGE_ID, "not json").run).scan("img")).status).toBe("failed");
    expect((await new DockerImageScanner(runner(IMAGE_ID, "{}").run).scan("img")).status).toBe("failed");
    const report = JSON.stringify({
      Results: [{ Target: "t", Vulnerabilities: [{ VulnerabilityID: "CVE-1", PkgName: "p", InstalledVersion: "1" }] }],
    });
    const r = runner(IMAGE_ID, report);
    const result = await new DockerImageScanner(r.run).scan("img");
    expect(result.status).toBe("success");
    expect(result.findings).toHaveLength(1);
    expect(r.calls[1]).toContain(IMAGE_ID);
  });
});
