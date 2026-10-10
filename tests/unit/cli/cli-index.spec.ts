import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const { execute, scanMain, workflowRun, runScanAudit } = vi.hoisted(() => ({
  execute: vi.fn(),
  scanMain: vi.fn(),
  workflowRun: vi.fn(),
  runScanAudit: vi.fn(),
}));

vi.mock("../../../src/core/orchestrator.js", () => ({
  AuditOrchestrator: vi.fn(function () {
    return { execute };
  }),
}));
vi.mock("../../../src/core/audit-context.js", () => ({ buildAuditContext: vi.fn(() => ({})) }));
vi.mock("../../../src/scan/bridge.js", () => ({ runScanAudit }));
vi.mock("../../../src/scan/cli.js", () => ({ main: scanMain }));
vi.mock("../../../src/cli/audit-cli.js", () => ({ run: workflowRun }));

import { createAuditReport, runCli } from "../../../src/cli/index.js";

const moduleResult = (name: string, severities: string[]): unknown => ({
  status: "issues",
  module: name,
  message: "",
  timestamp: 0,
  duration: 0,
  issues: severities.map((severity, i) => ({
    code: `${name}-${i}`,
    severity,
    title: "t",
    message: "m",
  })),
});

function unified(...results: unknown[]): unknown {
  return { success: true, results, findings: [], summary: {} };
}

describe("CLI entry (runCli)", () => {
  let out: string[] = [];
  let dir = "";

  beforeEach(() => {
    out = [];
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "muraqib-cli-"));
    execute.mockReset();
    scanMain.mockReset();
    workflowRun.mockReset();
    runScanAudit.mockReset();
    execute.mockResolvedValue(unified());
    vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
      out.push(a.join(" "));
    });
    vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
      out.push(a.join(" "));
    });
    process.exitCode = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(dir, { recursive: true, force: true });
    process.exitCode = undefined;
  });

  test("returns 0 and prints a text report for a clean project", async () => {
    expect(await runCli(["-p", dir])).toBe(0);
    expect(out.length).toBeGreaterThan(0);
  });

  test("returns 1 when critical or error issues exist", async () => {
    execute.mockResolvedValue(unified(moduleResult("m", ["critical"])));
    expect(await runCli(["-p", dir])).toBe(1);
    execute.mockResolvedValue(unified(moduleResult("m", ["error"])));
    expect(await runCli(["-p", dir])).toBe(1);
  });

  test("warnings fail only with --fail-on-warning", async () => {
    execute.mockResolvedValue(unified(moduleResult("m", ["warning"])));
    expect(await runCli(["-p", dir])).toBe(0);
    expect(await runCli(["-p", dir, "--fail-on-warning"])).toBe(1);
  });

  test("filters modules by name with --modules", async () => {
    execute.mockResolvedValue(
      unified(moduleResult("memory-guard", ["error"]), moduleResult("security-guard", []))
    );
    expect(await runCli(["-p", dir, "-m", "security", "-f", "json"])).toBe(0);
    const printed = out.join("\n");
    expect(printed).toContain("security-guard");
    expect(printed).not.toContain("memory-guard");
  });

  test("writes the report to a file with --output", async () => {
    const file = path.join(dir, "report.json");
    expect(await runCli(["-p", dir, "-f", "json", "-o", file, "-v"])).toBe(0);
    expect(JSON.parse(fs.readFileSync(file, "utf8")).projectRoot).toBe(dir);
    expect(out.join("\n")).toContain("Report saved to");
    expect(out.join("\n")).toContain("Audit completed successfully");
  });

  test("ignores an unsupported --format value", async () => {
    expect(await runCli(["-p", dir, "--format", "yaml"])).toBe(0);
  });

  test("runs the scan layer when --osv, --docker or --ai-advisory is given", async () => {
    runScanAudit.mockResolvedValue({
      result: { module: "scan", status: "ok", issues: [], message: "", timestamp: 0, duration: 0 },
      report: { aiAdvisory: "ai text" },
    });
    expect(await runCli(["-p", dir, "--osv", "--ai-advisory", "-f", "json"])).toBe(0);
    expect(runScanAudit).toHaveBeenCalledWith(dir, { enableAi: true, dockerNative: false });
    expect(out.join("\n")).toContain("ai text");
  });

  test("does not run the scan layer by default", async () => {
    await runCli(["-p", dir]);
    expect(runScanAudit).not.toHaveBeenCalled();
  });

  test("delegates resolve, image and runtime commands to the scan CLI", async () => {
    scanMain.mockImplementation(async () => {
      process.exitCode = 2;
    });
    expect(await runCli(["image", "nginx"])).toBe(2);
    expect(scanMain).toHaveBeenCalledWith(["image", "nginx"]);
    scanMain.mockResolvedValue(undefined);
    expect(await runCli(["runtime"])).toBe(0);
    expect(await runCli(["resolve", "--osv"])).toBe(0);
  });

  test("runs resolve inside the project root when it follows the options", async () => {
    const cwd = process.cwd();
    const chdir = vi.spyOn(process, "chdir").mockImplementation(() => undefined);
    scanMain.mockResolvedValue(undefined);
    expect(await runCli(["-p", dir, "-v", "resolve", "--package", "lodash", "--version", "1.0.0"])).toBe(0);
    expect(chdir).toHaveBeenCalledWith(dir);
    expect(scanMain).toHaveBeenCalledWith(["resolve"]);
    expect(process.cwd()).toBe(cwd);
  });

  test("delegates workflow-style flags to the workflow CLI", async () => {
    workflowRun.mockImplementation(async () => {
      process.exitCode = 4;
    });
    expect(await runCli(["--skip-network"])).toBe(4);
    process.exitCode = undefined;
    workflowRun.mockResolvedValue(undefined);
    expect(await runCli(["--url", "http://x"])).toBe(0);
    expect(workflowRun).toHaveBeenCalledTimes(2);
  });

  test("prints help and exits with 0 for --help", async () => {
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("exit");
    }) as never);
    expect(await runCli(["--help"])).toBe(1); // exit mock throws -> caught -> 1
    expect(exit).toHaveBeenCalledWith(0);
    expect(out.join("\n")).toContain("Muraqib Core CLI - Help");

    out = [];
    await runCli(["-p", dir, "resolve", "--help"]);
    expect(out.join("\n")).toContain("Muraqib Resolve");
  });

  test("prints the version for --version in audit mode", async () => {
    vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("exit");
    }) as never);
    await runCli(["--version"]);
    expect(out.join("\n")).toContain("Muraqib Core v");
  });

  test("returns 1 and prints the error when the orchestrator throws", async () => {
    execute.mockRejectedValue(new Error("kaboom"));
    expect(await runCli(["-p", dir])).toBe(1);
    expect(out.join("\n")).toContain("kaboom");
    execute.mockRejectedValue("string failure");
    expect(await runCli(["-p", dir])).toBe(1);
  });
});

describe("createAuditReport", () => {
  test("summarises issues by severity", async () => {
    execute.mockResolvedValue(
      unified(moduleResult("a", ["critical", "error", "warning", "info", "info"]))
    );
    const report = await createAuditReport({
      projectRoot: "/p",
      format: "json",
      verbose: false,
      failOnWarning: false,
    } as never);
    expect(report.summary).toEqual({ total: 5, critical: 1, high: 1, medium: 1, low: 2 });
    expect(Object.keys(report.modules)).toEqual(["a"]);
  });
});
