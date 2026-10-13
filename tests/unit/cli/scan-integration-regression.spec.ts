import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAuditReport, runCli } from "../../../src/cli/index.js";
import { runAuditForAgent } from "../../../src/agent/run-audit-for-agent.js";
import { runScanAudit } from "../../../src/scan/bridge.js";
import { OsvScanner } from "../../../src/scan/scanners/dependency/osv-engine.js";
import { formatCsv, formatHtml, formatJson, formatText } from "../../../src/cli/formatters.js";

let root: string;
const options = () => ({ projectRoot: root, format: "json" as const, verbose: false, failOnWarning: false, modules: ["scan"], scan: true });

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "muraqib-integration-"));
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

describe("unified scan policy and coverage", () => {
  it("preserves medium findings as warnings but blocks prod, not build", async () => {
    writeFileSync(join(root, "Dockerfile"), "FROM node:latest\n");
    const scan = await runScanAudit(root, { mode: "prod" });
    expect(scan.report.exitCode).toBe(1);
    expect(scan.result.status).toBe("issues");
    expect(scan.result.issues.every((issue) => issue.severity === "warning")).toBe(true);
    const prod = await createAuditReport({ ...options(), env: "prod" });
    expect(prod.exitCode).toBe(1);
    expect(prod.summary.error).toBe(0);
    expect(prod.summary.warning).toBeGreaterThan(0);
    const args = ["audit", "-p", root, "-m", "scan", "--json", "-e"];
    expect(await runCli([...args, "prod"])).toBe(1);
    expect(await runCli([...args, "build"])).toBe(0);
    expect(await runCli([...args, "build", "--fail-on-warning"])).toBe(1);
  });

  it("still blocks high findings in both modes", async () => {
    writeFileSync(join(root, ".env"), "BROKEN ASSIGNMENT\n");
    for (const mode of ["build", "prod"]) {
      expect(await runCli(["audit", "-p", root, "-m", "scan", "--json", "-e", mode])).toBe(1);
    }
  });

  it("retains partial scan inputs and diagnostics in every report format and the agent API", async () => {
    vi.spyOn(OsvScanner.prototype, "supports").mockReturnValue(true);
    vi.spyOn(OsvScanner.prototype, "scan").mockResolvedValue({
      scanner: "osv", status: "partial", findings: [],
      scannedInputs: ["safe@1.0.0"], skippedInputs: ["unknown@^2"],
      diagnostics: ['Network unavailable <script> "quoted"'],
    });
    const report = await createAuditReport(options());
    expect(report.exitCode).toBe(0);
    for (const formatted of [formatJson(report), formatText(report), formatCsv(report)]) {
      expect(formatted).toContain("partial");
      expect(formatted).toContain("safe@1.0.0");
      expect(formatted).toContain("unknown@^2");
      expect(formatted).toContain("Network unavailable");
    }
    const html = formatHtml(report);
    expect(html).toContain("partial");
    expect(html).toContain("unknown@^2");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    const agent = await runAuditForAgent({ projectRoot: root, modules: ["scan"], osv: true });
    expect(agent.ok).toBe(true);
    expect(agent.modules.find((module) => module.name === "scan")?.scan?.scannerCoverage[0]).toMatchObject({
      status: "partial", scannedInputs: ["safe@1.0.0"], skippedInputs: ["unknown@^2"],
    });
  });

  it("reports a thrown scanner error as failure rather than a policy finding", async () => {
    vi.spyOn(OsvScanner.prototype, "supports").mockReturnValue(true);
    vi.spyOn(OsvScanner.prototype, "scan").mockRejectedValue(new Error("Scanner crashed"));
    const report = await createAuditReport(options());
    expect(report.exitCode).toBe(3);
    expect(formatText(report)).toContain("Scanner crashed");
    expect(await runCli(["audit", "-p", root, "-m", "scan", "--osv", "--json"])).toBe(3);
  });

  it("returns scanner failure code 3 through reports, CLI, and agent command", async () => {
    vi.spyOn(OsvScanner.prototype, "supports").mockReturnValue(true);
    vi.spyOn(OsvScanner.prototype, "scan").mockResolvedValue({
      scanner: "osv", status: "failed", findings: [], error: "OSV unavailable",
      diagnostics: ["Connection failed"], scannedInputs: [], skippedInputs: ["x@1"],
    });
    const report = await createAuditReport(options());
    expect(report.exitCode).toBe(3);
    expect(report.modules["scan"]).toMatchObject({ status: "error", scan: { exitCode: 3 } });
    expect(await runCli(["audit", "-p", root, "-m", "scan", "--osv", "--json", "--fail-on-warning"])).toBe(3);
    const agent = await runAuditForAgent({ projectRoot: root, modules: ["scan"], osv: true, maxIssues: 0 });
    expect(agent).toMatchObject({ ok: false, verdict: "fail", exitCode: 3 });
    expect(agent.issues).toEqual([]);
    expect(agent.modules[0]?.scan?.scannerCoverage[0]?.diagnostics).toEqual(["Connection failed"]);
    expect(await runCli(["agent", "-p", root, "-m", "scan", "--osv"])).toBe(3);
  });
});
