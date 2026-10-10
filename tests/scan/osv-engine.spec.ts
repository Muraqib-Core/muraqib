import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

vi.mock("../../src/scan/scanners/dependency/osv-client.js", () => ({
  queryOsv: vi.fn(),
}));

import { queryOsv } from "../../src/scan/scanners/dependency/osv-client.js";
import { OsvScanner } from "../../src/scan/scanners/dependency/osv-engine.js";

const query = vi.mocked(queryOsv);

describe("OsvScanner (mocked OSV client)", () => {
  let dir = "";

  const writePkg = (pkg: object): void =>
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify(pkg));
  const install = (name: string, version: string): void => {
    const p = path.join(dir, "node_modules", name);
    fs.mkdirSync(p, { recursive: true });
    fs.writeFileSync(path.join(p, "package.json"), JSON.stringify({ version }));
  };
  const scan = (scanner = new OsvScanner()) =>
    scanner.scan({ projectPath: dir, files: ["package.json"] });

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "muraqib-osv-engine-"));
    query.mockReset();
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("returns failed status when package.json is not valid JSON", async () => {
    fs.writeFileSync(path.join(dir, "package.json"), "{ nope");
    const result = await scan();
    expect(result.status).toBe("failed");
    expect(result.error).toContain("parse package.json");
  });

  test("returns success with no findings when there are no dependencies", async () => {
    writePkg({ name: "x" });
    const result = await scan();
    expect(result).toMatchObject({ status: "success", findings: [] });
    expect(query).not.toHaveBeenCalled();
  });

  test("creates a security finding with fixed versions and affected ranges", async () => {
    writePkg({ dependencies: { lodash: "^4.17.0" } });
    install("lodash", "4.17.1");
    query.mockResolvedValue({
      status: "success",
      data: {
        vulns: [
          {
            id: "GHSA-a",
            summary: "bad",
            affected: [
              {
                ranges: [
                  { type: "SEMVER", events: [{ introduced: "0" }, { fixed: "4.17.21" }] },
                  { type: "SEMVER", events: [{ fixed: "3.0.1" }] },
                  { type: "SEMVER", events: [{ introduced: "5.0.0" }] },
                  { type: "SEMVER", events: [{ fixed: "6.0.0-beta.1" }] },
                  { type: "GIT" },
                ],
              },
              {},
            ],
          },
          { id: "GHSA-b" },
        ],
      },
    });

    const result = await scan();

    expect(query).toHaveBeenCalledWith("lodash", "4.17.1");
    expect(result.status).toBe("success");
    expect(result.findings).toHaveLength(1);
    const finding = result.findings[0]!;
    expect(finding.level).toBe("high");
    expect(finding.severity).toBe("error");
    expect(finding.message).toContain("2 known vulnerabilities");
    const problem = finding.dependencyProblem;
    expect(problem?.fixedVersions).toEqual(["3.0.1", "4.17.21"]);
    expect(problem?.affectedRanges).toEqual(
      expect.arrayContaining([">= 0 < 4.17.21", "< 3.0.1", ">= 5.0.0"])
    );
    expect(problem?.advisoryCount).toBe(2);
  });

  test("uses the singular form for a single vulnerability", async () => {
    writePkg({ dependencies: { a: "1.0.0" } });
    query.mockResolvedValue({ status: "success", data: { vulns: [{ id: "X" }] } });
    const result = await scan();
    expect(result.findings[0]?.message).toContain("1 known vulnerability.");
  });

  test("reports no finding for a package without vulnerabilities", async () => {
    writePkg({ dependencies: { a: "1.0.0" } });
    query.mockResolvedValue({ status: "success", data: {} });
    const result = await scan();
    expect(result).toMatchObject({ status: "success", findings: [] });
  });

  test("scans dev, peer and optional dependencies without duplicates", async () => {
    writePkg({
      dependencies: { a: "1.0.0" },
      devDependencies: { a: "1.0.0", b: "2.0.0" },
      peerDependencies: { c: "3.0.0" },
      optionalDependencies: { d: "4.0.0" },
    });
    query.mockResolvedValue({ status: "success", data: {} });
    await scan();
    expect(query.mock.calls.map((c) => c[0]).sort()).toEqual(["a", "b", "c", "d"]);
  });

  test("falls back to the declared version when the installed package.json is broken", async () => {
    writePkg({ dependencies: { a: "^1.2.3" } });
    const p = path.join(dir, "node_modules", "a");
    fs.mkdirSync(p, { recursive: true });
    fs.writeFileSync(path.join(p, "package.json"), "{ broken");
    query.mockResolvedValue({ status: "success", data: {} });
    await scan();
    expect(query).toHaveBeenCalledWith("a", "1.2.3");
  });

  test("skips non-exact versions and reports a failed scan when nothing was verified", async () => {
    writePkg({ dependencies: { a: "latest", b: "*" } });
    const result = await scan();
    expect(query).not.toHaveBeenCalled();
    expect(result.status).toBe("failed");
    expect(result.diagnostics?.[0]).toContain("did not resolve to an exact installed version");
  });

  test("reports partial status when some queries succeed and others fail", async () => {
    writePkg({ dependencies: { good: "1.0.0", slow: "1.0.0", down: "1.0.0", weird: "1.0.0" } });
    query.mockImplementation(async (name) => {
      if (name === "good") return { status: "success", data: {} };
      if (name === "slow") return { status: "timeout", error: "t" };
      if (name === "down") return { status: "unavailable", error: "503" };
      return { status: "error", error: "parse" };
    });
    const result = await scan();
    expect(result.status).toBe("partial");
    expect(result.diagnostics).toHaveLength(3);
    expect(result.diagnostics?.some((d) => d.includes("timed out"))).toBe(true);
  });

  test("reports failed status when every query fails", async () => {
    writePkg({ dependencies: { a: "1.0.0" } });
    query.mockResolvedValue({ status: "unavailable", error: "offline" });
    const result = await scan();
    expect(result.status).toBe("failed");
  });

  test("sorts findings by id", async () => {
    writePkg({ dependencies: { zeta: "1.0.0", alpha: "1.0.0" } });
    query.mockResolvedValue({ status: "success", data: { vulns: [{ id: "V" }] } });
    const result = await scan();
    expect(result.findings.map((f) => f.code)).toEqual(["osv-alpha", "osv-zeta"]);
  });

  test("respects the concurrency limit", async () => {
    writePkg({ dependencies: { a: "1.0.0", b: "1.0.0", c: "1.0.0", d: "1.0.0" } });
    let active = 0;
    let peak = 0;
    query.mockImplementation(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active -= 1;
      return { status: "success", data: {} };
    });
    await scan(new OsvScanner(2));
    expect(peak).toBeLessThanOrEqual(2);
    expect(query).toHaveBeenCalledTimes(4);
  });

  test("prefers dependencies supplied on the scan context", async () => {
    writePkg({ dependencies: { fromFile: "1.0.0" } });
    query.mockResolvedValue({ status: "success", data: {} });
    await new OsvScanner().scan({
      projectPath: dir,
      files: [],
      dependencies: { fromContext: "2.0.0" },
      devDependencies: {},
    });
    expect(query.mock.calls.map((c) => c[0])).toEqual(["fromContext"]);
  });
});
