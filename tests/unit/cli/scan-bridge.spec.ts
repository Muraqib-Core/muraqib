import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { findingToAuditIssue, runScanAudit } from "../../../src/scan/bridge.js";
import { createAuditReport } from "../../../src/cli/index.js";
import type { Finding } from "../../../src/scan/core/findings/finding.js";

const base: Finding = { id: "x", title: "t", message: "m", severity: "high", category: "security", source: "osv" };

describe("scan bridge", () => {
  it("maps severities and metadata", () => {
    expect(findingToAuditIssue({ ...base, severity: "high" }).severity).toBe("error");
    expect(findingToAuditIssue({ ...base, severity: "medium" }).severity).toBe("warning");
    expect(findingToAuditIssue({ ...base, severity: "low" }).severity).toBe("info");
    const i = findingToAuditIssue({ ...base, file: ".env", line: 3, remediation: "fix", confidence: "confirmed" });
    expect(i.location).toEqual({ file: ".env", line: 3 });
    expect(i.recommendation).toBe("fix");
    expect(i.tags).toContain("confirmed");
  });

  it("adds advisory ids and an upgrade recommendation for OSV dependency problems", () => {
    const problem = {
      package: "lodash",
      installedVersion: "4.17.15",
      declaredVersion: "4.17.15",
      dependencyType: "dependencies" as const,
      advisoryCount: 5,
      advisories: ["GHSA-a", "GHSA-b", "GHSA-c", "GHSA-d", "GHSA-e"].map((id) => ({ id })),
      affectedRanges: [],
      fixedVersions: ["4.17.12", "4.17.21"],
    };
    const i = findingToAuditIssue({ ...base, message: "has 5 known vulnerabilities.", dependencyProblem: problem });
    expect(i.message).toContain("GHSA-a, GHSA-b, GHSA-c (+2 more)");
    expect(i.recommendation).toBe("Upgrade lodash to >= 4.17.21");
    const noFix = findingToAuditIssue({ ...base, dependencyProblem: { ...problem, fixedVersions: [] } });
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
