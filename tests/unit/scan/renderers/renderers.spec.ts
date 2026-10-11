import { stripVTControlCharacters } from "node:util";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderFindings } from "../../../../src/scan/cli/renderers/finding-renderer.js";
import { formatSummaryText } from "../../../../src/scan/cli/renderers/summary-renderer.js";
import { renderAiAdvisory } from "../../../../src/scan/cli/renderers/ai-renderer.js";
import { renderJsonReport } from "../../../../src/scan/cli/renderers/json-renderer.js";
import { createScanIssue, type FindingCategory, type FindingSeverity, type ScanIssue } from "../../../../src/scan/core/findings/finding.js";
import type { AuditReport } from "../../../../src/scan/core/runner/audit-runner.js";

const strip = stripVTControlCharacters;

function issue(
  category: FindingCategory,
  severity: FindingSeverity,
  extra: { file?: string; line?: number; remediation?: string } = {}
): ScanIssue {
  return createScanIssue({
    id: `T-${category}-${severity}`,
    title: "t",
    message: `${category} ${severity} message`,
    severity,
    category,
    source: "test",
    ...extra,
  });
}

function depIssue(count: number, file?: string): ScanIssue {
  return createScanIssue({
    id: "OSV",
    title: "dep",
    message: "dep problem",
    severity: "high",
    category: "security",
    source: "osv",
    ...(file ? { file } : {}),
    dependencyProblem: {
      package: "lodash",
      installedVersion: "4.0.0",
      declaredVersion: "^4.0.0",
      dependencyType: "dependencies",
      advisoryCount: count,
      advisories: [],
      affectedRanges: [],
      fixedVersions: [],
    },
  });
}

function baseReport(over: Partial<AuditReport> = {}): AuditReport {
  return {
    findings: [],
    totalParsedLines: 3,
    engine: "zod",
    mode: "build",
    scannedEnvFiles: [".env"],
    aiAdvisory: null,
    scannerCoverage: [],
    hasBlockingIssues: false,
    exitCode: 0,
    ...over,
  };
}

let out: string[];
beforeEach(() => {
  out = [];
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
    out.push(strip(a.map(String).join(" ")));
  });
});
afterEach(() => vi.restoreAllMocks());

describe("renderFindings", () => {
  it("prints nothing for an empty list", () => {
    renderFindings([]);
    expect(out).toEqual([]);
  });

  it("renders validation errors/warnings with and without a location", () => {
    renderFindings([
      issue("validation", "high", { file: ".env", line: 4 }),
      issue("configuration", "medium", { file: ".env.local" }),
      issue("validation", "critical"),
    ]);
    const text = out.join("\n");
    expect(text).toContain("Configuration & Validation Issues");
    expect(text).toContain("ERROR");
    expect(text).toContain("WARN");
    expect(text).toContain("[.env:4]");
    expect(text).toContain("[.env.local]");
    expect(text).toContain("[ENV]");
  });

  it("renders dependency problems with singular/plural advisories and file fallback", () => {
    renderFindings([depIssue(1, "package.json"), depIssue(3)]);
    const text = out.join("\n");
    expect(text).toContain("Dependency Problems");
    expect(text).toContain("1 known vulnerability");
    expect(text).toContain("3 known vulnerabilities");
    expect(text).toContain("[package.json] lodash@4.0.0");
  });

  it("renders other security findings, critical badge and remediation", () => {
    renderFindings([
      issue("security", "critical", { file: "a.ts", remediation: "rotate key" }),
      issue("security", "high"),
    ]);
    const text = out.join("\n");
    expect(text).toContain("Security Vulnerabilities");
    expect(text).toContain("CRIT");
    expect(text).toContain("VULN");
    expect(text).toContain("[a.ts]");
    expect(text).toContain("[deps]");
    expect(text).toContain("Remediation: rotate key");
  });

  it("renders compatibility and reliability findings", () => {
    renderFindings([
      issue("compatibility", "medium", { file: "x.json", remediation: "upgrade" }),
      issue("compatibility", "low"),
      issue("reliability", "info"),
    ]);
    const text = out.join("\n");
    expect(text).toContain("Compatibility & Environment Conflicts");
    expect(text).toContain("[x.json]");
    expect(text).toContain("[env]");
    expect(text).toContain("Remediation: upgrade");
    expect(text).toContain("Scanner Diagnostics & Reliability");
    expect(text).toContain("INFO");
  });
});

describe("formatSummaryText", () => {
  it("reports a clean run", () => {
    const text = strip(formatSummaryText(baseReport()));
    expect(text).toContain("Scanned Env Files: .env");
    expect(text).toContain("Total Findings: 0");
    expect(text).toContain("No blocking findings");
    expect(text).not.toContain("Scanner Coverage");
  });

  it("falls back to None and reports non-blocking warnings", () => {
    const text = strip(
      formatSummaryText(baseReport({ scannedEnvFiles: [], findings: [issue("validation", "medium")] }))
    );
    expect(text).toContain("Scanned Env Files: None");
    expect(text).toContain("Total Findings: 1");
    expect(text).toContain("Informational warnings");
  });

  it("reports blocking issues and per-scanner coverage", () => {
    const text = strip(
      formatSummaryText(
        baseReport({
          hasBlockingIssues: true,
          findings: [issue("security", "high")],
          scannerCoverage: [
            { scanner: "osv", status: "success", scannedInputs: ["package.json", "lock"], skippedInputs: [], diagnostics: [] },
            { scanner: "docker", status: "partial", scannedInputs: [], skippedInputs: [], diagnostics: [] },
            { scanner: "image", status: "failed", scannedInputs: [], skippedInputs: [], diagnostics: [] },
          ],
        })
      )
    );
    expect(text).toContain("Fix required before deployment");
    expect(text).toContain("osv: success (2 files scanned)");
    expect(text).toContain("docker: partial");
    expect(text).toContain("image: failed");
  });
});

describe("renderAiAdvisory", () => {
  it("prints nothing without advice", () => {
    renderAiAdvisory(null);
    renderAiAdvisory("");
    expect(out).toEqual([]);
  });

  it("prints non-empty advice lines", () => {
    renderAiAdvisory("first\n\n  \nsecond");
    const text = out.join("\n");
    expect(text).toContain("Muraqib AI Advice");
    expect(text).toContain("│  first");
    expect(text).toContain("│  second");
  });
});

describe("renderJsonReport", () => {
  it("emits a passed report", () => {
    renderJsonReport(baseReport());
    const parsed = JSON.parse(out.join("\n")) as Record<string, unknown>;
    expect(parsed["status"]).toBe("passed");
    expect(parsed["schemaVersion"]).toBe("2.0");
  });

  it("emits a failed report", () => {
    renderJsonReport(baseReport({ exitCode: 1, aiAdvisory: "fix it" }));
    const parsed = JSON.parse(out.join("\n")) as Record<string, unknown>;
    expect(parsed["status"]).toBe("failed");
    expect(parsed["aiAdvisory"]).toBe("fix it");
  });
});
