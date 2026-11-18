import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const { execute, scanMain, runHookCli, runScanAudit } = vi.hoisted(() => ({
  execute: vi.fn(),
  runScanAudit: vi.fn(),
  scanMain: vi.fn(),
  runHookCli: vi.fn(),
}));

vi.mock("../../../src/core/orchestrator.js", () => ({
  AuditOrchestrator: vi.fn(function () {
    return { execute };
  }),
}));
vi.mock("../../../src/core/audit-context.js", () => ({ buildAuditContext: vi.fn(() => ({})) }));
vi.mock("../../../src/scan/bridge.js", () => ({ runScanAudit }));
vi.mock("../../../src/scan/cli.js", () => ({ main: scanMain }));
vi.mock("../../../src/hooks/cli.js", () => ({ runHookCli }));
const ui = vi.hoisted(() => ({
  promptScanChoices: vi.fn(),
  promptCategories: vi.fn(),
  promptSecurityUrl: vi.fn(),
  promptAfterReport: vi.fn(),
  showFixes: vi.fn(),
  showAssistantPrompt: vi.fn(),
  showReport: vi.fn(),
  showIntro: vi.fn(),
  showOutro: vi.fn(),
  showCancelled: vi.fn(),
}));
vi.mock("../../../src/cli/interactive.js", async (orig) => ({
  ...(await orig<typeof import("../../../src/cli/interactive.js")>()),
  ...ui,
  withSpinner: <T>(_l: string, task: () => Promise<T>): Promise<T> => task(),
}));

import { runCli } from "../../../src/cli/index.js";

// `resolve` chdirs into the project, so every test must restore the original working directory.
const originalCwd = process.cwd();

const clean = { success: true, results: [], findings: [], summary: {} };

describe("CLI argument edge cases", () => {
  let out: string[] = [];
  let dir = "";

  beforeEach(() => {
    out = [];
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "muraqib-cli-branches-"));
    execute.mockReset();
    scanMain.mockReset();
    runHookCli.mockReset();
    execute.mockResolvedValue(clean);
    vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
      out.push(a.join(" "));
    });
    vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
      out.push(a.join(" "));
    });
    process.exitCode = undefined;
  });

  afterEach(() => {
    process.chdir(originalCwd);
    vi.restoreAllMocks();
    fs.rmSync(dir, { recursive: true, force: true });
    process.exitCode = undefined;
  });

  test("--max-issues ignores values that are not non-negative integers", async () => {
    for (const bad of ["abc", "-3", "1.5x", ""]) {
      out = [];
      expect(await runCli(["agent", "-p", dir, "--max-issues", bad])).toBe(0);
      expect(JSON.parse(out.join("\n")).truncated).toBe(0);
    }
    out = [];
    expect(await runCli(["agent", "-p", dir, "--max-issues", "0"])).toBe(0);
  });

  test("flags that need a value tolerate a missing one", async () => {
    expect(await runCli(["-p", dir, "-m"])).toBe(0);
    expect(await runCli(["-p", dir, "--security-url"])).toBe(0);
    expect(await runCli(["-p", dir, "--package"])).toBe(0);
    expect(await runCli(["-p", dir, "-o"])).toBe(0);
  });

  test("--env and --engine report a missing value", async () => {
    expect(await runCli(["-p", dir, "--env"])).toBe(1);
    expect(out.join("\n")).toContain("Invalid environment mode ''");
    out = [];
    expect(await runCli(["-p", dir, "--engine"])).toBe(1);
    expect(out.join("\n")).toContain("Invalid validation engine ''");
  });

  test("--version after resolve is the package version and does not print the CLI version", async () => {
    scanMain.mockResolvedValue(undefined);
    expect(await runCli(["-p", dir, "resolve", "--version", "1.2.3", "--package", "axios"])).toBe(0);
    expect(scanMain).toHaveBeenCalledWith(["resolve"]);
    expect(out.join("\n")).not.toContain("Muraqib Core v");
  });

  test("--version is ignored by commands other than audit and resolve", async () => {
    expect(await runCli(["agent", "-p", dir, "--version"])).toBe(0);
    expect(out.join("\n")).not.toContain("Muraqib Core v");
  });

  test("scan-layer commands return the exit code the scan CLI set", async () => {
    scanMain.mockImplementation(async () => {
      process.exitCode = 3;
    });
    expect(await runCli(["image", "--image", "nginx"])).toBe(3);
    scanMain.mockImplementation(async () => undefined);
    expect(await runCli(["runtime", "--container", "web"])).toBe(0);
  });

  test("hook commands are delegated to the hook CLI", async () => {
    runHookCli.mockResolvedValue(7);
    expect(await runCli(["hook", "install", "--pre-push"])).toBe(7);
    expect(runHookCli).toHaveBeenCalledWith(["install", "--pre-push"]);
  });

  test("verbose audits narrate their progress and confirm the saved report", async () => {
    const file = path.join(dir, "out.txt");
    expect(await runCli(["-p", dir, "-v", "-o", file])).toBe(0);
    const text = out.join("\n");
    expect(text).toContain("Starting Muraqib Core audit");
    expect(text).toContain(`Report saved to: ${file}`);
    expect(text).toContain("Audit completed successfully");
  });

  test("the context and tool-schema commands do not require a project directory", async () => {
    expect(await runCli(["context", "-p", path.join(dir, "missing")])).toBe(0);
    expect(await runCli(["tool-schema", "-p", path.join(dir, "missing")])).toBe(0);
  });
});

describe("guided prompts", () => {
  let dir = "";
  const setTty = (v: boolean): void => {
    Object.defineProperty(process.stdout, "isTTY", { value: v, configurable: true });
    Object.defineProperty(process.stdin, "isTTY", { value: v, configurable: true });
  };
  let savedCi: string | undefined;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "muraqib-cli-guided-"));
    execute.mockReset();
    execute.mockResolvedValue(clean);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    savedCi = process.env["CI"];
    delete process.env["CI"];
    Object.values(ui).forEach((f) => f.mockReset());
    ui.promptScanChoices.mockResolvedValue({ osv: false, docker: false, aiAdvisory: false });
    ui.promptAfterReport.mockResolvedValue("done");
    setTty(true);
  });

  afterEach(() => {
    setTty(false);
    if (savedCi === undefined) delete process.env["CI"];
    else process.env["CI"] = savedCi;
    vi.restoreAllMocks();
    fs.rmSync(dir, { recursive: true, force: true });
    process.exitCode = undefined;
  });

  test("a chosen security URL is passed on to the audit", async () => {
    ui.promptCategories.mockResolvedValue({ modules: ["security-guard"], ids: [] });
    ui.promptSecurityUrl.mockResolvedValue("http://localhost:3000");
    expect(await runCli(["-p", dir, "-i"])).toBe(0);
    expect(ui.promptSecurityUrl).toHaveBeenCalled();
  });

  test("cancelling the security URL prompt exits with 130", async () => {
    ui.promptCategories.mockResolvedValue({ modules: ["security-guard"], ids: [] });
    ui.promptSecurityUrl.mockResolvedValue(null);
    expect(await runCli(["-p", dir, "-i"])).toBe(130);
    expect(ui.showCancelled).toHaveBeenCalled();
  });

  test("an explicit --security-url skips the URL prompt", async () => {
    ui.promptCategories.mockResolvedValue({ modules: ["security-guard"], ids: [] });
    expect(await runCli(["-p", dir, "-i", "--security-url", "http://localhost:1"])).toBe(0);
    expect(ui.promptSecurityUrl).not.toHaveBeenCalled();
  });

  test("scan flags given up front skip the scan-choice prompt", async () => {
    ui.promptCategories.mockResolvedValue({ modules: undefined, ids: ["full"] });
    runScanAudit.mockResolvedValue({
      result: { module: "scan", status: "ok", issues: [], message: "", timestamp: 0, duration: 0 },
      report: { aiAdvisory: null },
    });
    expect(await runCli(["-p", dir, "-i", "--ai-advisory"])).toBe(0);
    expect(ui.promptScanChoices).not.toHaveBeenCalled();
  });

  test("follow-up actions: unknown actions are ignored and the HTML report is written to the cwd", async () => {
    const cwd = vi.spyOn(process, "cwd").mockReturnValue(dir);
    ui.promptCategories.mockResolvedValue({ modules: undefined, ids: ["full"] });
    ui.promptAfterReport.mockResolvedValueOnce("html").mockResolvedValueOnce("all").mockResolvedValue("done");
    expect(await runCli(["-p", dir, "-i"])).toBe(0);
    expect(fs.existsSync(path.join(dir, "muraqib-report.html"))).toBe(true);
    cwd.mockRestore();
  });
});
