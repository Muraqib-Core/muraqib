import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { enrichIssue, runScanAudit } from "../../../src/scan/bridge.js";
import { createAuditReport } from "../../../src/cli/index.js";
import { createScanIssue, type ScanIssueInput } from "../../../src/scan/core/findings/finding.js";

const base: ScanIssueInput = { id: "x", title: "t", message: "m", severity: "high", category: "security", source: "osv" };

const toIssue = (input: ScanIssueInput) => enrichIssue(createScanIssue(input));

describe("scan bridge", () => {
  it("maps severities and metadata", () => {
    expect(toIssue({ ...base, severity: "high" }).severity).toBe("error");
    expect(toIssue({ ...base, severity: "medium" }).severity).toBe("warning");
    expect(toIssue({ ...base, severity: "low" }).severity).toBe("info");
    const i = toIssue({ ...base, file: ".env", line: 3, remediation: "fix", confidence: "confirmed" });
    expect(i.location).toEqual({ file: ".env", line: 3 });
    expect(i.recommendation).toBe("fix");
    expect(i.tags).toContain("confirmed");
  });

  it("carries scan detail through to the issue", () => {
    const image = { imageId: "i", target: "t", ecosystem: "npm", package: "p", installedVersion: "1", advisoryId: "A", scannedAt: "now" };
    const i = toIssue({ ...base, key: "PORT", evidence: "PORT=x", imageProblem: image });
    expect(i.key).toBe("PORT");
    expect(i.evidence).toBe("PORT=x");
    expect(i.imageProblem).toEqual(image);
    expect(i.confidence).toBeUndefined();
    expect(i.code).toBe("x");
    expect(i.level).toBe("high");
    expect(i.category).toBe("security");
    expect(i.source).toBe("osv");
  });

  it("adds advisory ids and an upgrade recommendation for OSV dependency problems", () => {
    const problem = {
      package: "lodash",
      installedVersion: "4.17.15",
      declaredVersion: "4.17.15",
      dependencyType: "dependencies" as const,
      advisoryCount: 5,
      advisories: ["GHSA-a", "GHSA-b", "GHSA-c", "GHSA-d", "GHSA-e"].map((id) => ({
        id,
        ranges: [{ type: "SEMVER", events: [{ introduced: "0" }, { fixed: id === "GHSA-e" ? "4.17.21" : "4.17.12" }] }],
      })),
      affectedRanges: [],
      fixedVersions: ["4.17.12", "4.17.21"],
    };
    const i = toIssue({ ...base, message: "has 5 known vulnerabilities.", dependencyProblem: problem });
    expect(i.message).toContain("GHSA-a, GHSA-b, GHSA-c (+2 more)");
    expect(i.recommendation).toBe("Upgrade lodash to >= 4.17.21");
    // fixes on other major lines must not inflate the target
    const otherLine = {
      ...problem,
      advisories: [
        {
          id: "GHSA-x",
          ranges: [
            { type: "SEMVER", events: [{ introduced: "0" }, { fixed: "4.17.21" }] },
            { type: "SEMVER", events: [{ introduced: "5.0.0" }, { fixed: "5.2.0" }] },
          ],
        },
      ],
      fixedVersions: ["4.17.21", "5.2.0"],
    };
    expect(toIssue({ ...base, dependencyProblem: otherLine }).recommendation).toBe("Upgrade lodash to >= 4.17.21");
    const noFix = toIssue({ ...base, dependencyProblem: { ...problem, advisories: [{ id: "GHSA-n" }], fixedVersions: [] } });
    expect(noFix.recommendation).toBeUndefined();
  });

  it("runs the real scan runner on a project with a bad .env", async () => {
    const dir = mkdtempSync(join(tmpdir(), "muraqib-scan-"));
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "x", version: "1.0.0" }));
    writeFileSync(join(dir, ".env"), "PORT=notaport\n");
    const { result } = await runScanAudit(dir);
    expect(result.module).toBe("scan");
    expect(result.issues.some((i) => i.code === "preset-violation-PORT")).toBe(true);
  });

  it("createAuditReport includes the scan module only when requested", async () => {
    const dir = mkdtempSync(join(tmpdir(), "muraqib-scan-"));
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "x", version: "1.0.0" }));
    const opts = { projectRoot: dir, format: "json" as const, verbose: false, failOnWarning: false, modules: ["memory"] };
    expect(Object.keys((await createAuditReport(opts)).modules)).not.toContain("scan");
    expect(Object.keys((await createAuditReport({ ...opts, scan: true })).modules)).toContain("scan");
  });
});
