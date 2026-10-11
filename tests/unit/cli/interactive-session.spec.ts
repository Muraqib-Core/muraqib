import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, test, vi } from "vitest";

const clack = vi.hoisted(() => {
  const spinner = { start: vi.fn(), stop: vi.fn(), error: vi.fn() };
  return {
    spinner,
    intro: vi.fn(),
    outro: vi.fn(),
    cancel: vi.fn(),
    note: vi.fn(),
    select: vi.fn(),
    text: vi.fn(),
    multiselect: vi.fn(),
    log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), message: vi.fn(), success: vi.fn() },
    isCancel: vi.fn((v: unknown) => v === "CANCEL"),
  };
});

vi.mock("@clack/prompts", () => ({ ...clack, spinner: () => clack.spinner }));

import {
  promptAuditScope,
  promptNextStep,
  promptSaveReport,
  promptSecurityUrl,
  runInteractiveSession,
  showFixes,
  showIssues,
  showReport,
  type InteractiveAuditOptions,
} from "../../../src/cli/interactive.js";
import { collectIssues } from "../../../src/cli/interactive-model.js";
import type { AuditReport } from "../../../src/cli/types.js";

const failing: AuditReport = {
  timestamp: 0,
  projectRoot: "/proj",
  summary: { total: 3, critical: 0, error: 1, warning: 1, info: 1 },
  modules: {
    "config-guard": {
      issues: [
        { severity: "error", title: "Missing .gitignore", message: "No .gitignore", recommendation: "Create .gitignore", location: { file: "package.json", line: 2 } },
        { severity: "warning", title: "No license", message: "License missing" },
        { severity: "info", title: "Tip", message: "Consider more" },
      ],
    },
    "memory-guard": { issues: [] },
  },
};
const clean: AuditReport = { timestamp: 0, projectRoot: "/proj", summary: { total: 0, critical: 0, error: 0, warning: 0, info: 0 }, modules: { "memory-guard": { issues: [] } } };

beforeEach(() => {
  for (const fn of [clack.intro, clack.outro, clack.cancel, clack.note, clack.select, clack.text, clack.multiselect, ...Object.values(clack.log), ...Object.values(clack.spinner)]) fn.mockReset();
});

describe("promptAuditScope", () => {
  test("returns the module filters of a named scope", async () => {
    clack.select.mockResolvedValue("performance");
    expect(await promptAuditScope()).toEqual(["image", "memory"]);
  });

  test("full audit means no filters", async () => {
    clack.select.mockResolvedValue("full");
    expect(await promptAuditScope()).toEqual([]);
  });

  test("custom scope asks for individual modules", async () => {
    clack.select.mockResolvedValue("custom");
    clack.multiselect.mockResolvedValue(["async", "config"]);
    expect(await promptAuditScope()).toEqual(["async", "config"]);
  });

  test("cancelling either prompt returns null", async () => {
    clack.select.mockResolvedValue("CANCEL");
    expect(await promptAuditScope()).toBeNull();
    clack.select.mockResolvedValue("custom");
    clack.multiselect.mockResolvedValue("CANCEL");
    expect(await promptAuditScope()).toBeNull();
  });
});

describe("promptSecurityUrl", () => {
  test("trims the URL, treats empty as skipped and null as cancelled", async () => {
    clack.text.mockResolvedValueOnce("  http://localhost:3000 ");
    expect(await promptSecurityUrl()).toBe("http://localhost:3000");
    clack.text.mockResolvedValueOnce("");
    expect(await promptSecurityUrl()).toBeUndefined();
    clack.text.mockResolvedValueOnce("CANCEL");
    expect(await promptSecurityUrl()).toBeNull();
  });

  test("validates the input", async () => {
    clack.text.mockResolvedValue("");
    await promptSecurityUrl();
    const validate = clack.text.mock.calls[0]?.[0].validate as (v: string | undefined) => string | undefined;
    expect(validate("")).toBeUndefined();
    expect(validate(undefined)).toBeUndefined();
    expect(validate("https://ok.test")).toBeUndefined();
    expect(validate("ftp://nope")).toMatch(/http/);
    expect(validate("not a url")).toMatch(/http/);
  });
});

describe("rendering", () => {
  test("showReport prints verdict, counts and every module in one note", () => {
    showReport(failing);
    const [body, title] = clack.note.mock.calls[0] as [string, string];
    expect(title).toBe("Results");
    expect(body).toContain("FAILED");
    expect(body).toContain("1 error");
    expect(body).toContain("config-guard");
    expect(body).toContain("memory-guard");
    expect(body).toContain("3 issues");
  });

  test("showReport reports a pass and singular wording", () => {
    showReport(clean);
    expect(clack.note.mock.calls[0]?.[0]).toContain("PASSED");
    showReport({ ...failing, summary: { ...failing.summary, error: 0 }, modules: { m: { issues: [{ severity: "warning", title: "t", message: "m" }] } } });
    expect(clack.note.mock.calls[1]?.[0]).toContain("1 issue,");
  });

  test("showIssues routes by severity, includes location and fix, and reports the overflow", () => {
    showIssues(collectIssues(failing));
    expect(clack.log.error.mock.calls[0]?.[0]).toContain("package.json:2");
    expect(clack.log.error.mock.calls[0]?.[0]).toContain("Create .gitignore");
    expect(clack.log.warn).toHaveBeenCalledTimes(1);
    expect(clack.log.info).toHaveBeenCalledTimes(1);

    showIssues(collectIssues(failing), 1);
    expect(clack.log.message.mock.calls[0]?.[0]).toContain("2 more");
  });

  test("showIssues does not repeat a file name the title already contains", () => {
    showIssues([{ module: "m", severity: "error", title: "Config: .eslintignore", message: "gone", file: ".eslintignore" }]);
    expect(String(clack.log.error.mock.calls[0]?.[0]).match(/\.eslintignore/g)).toHaveLength(1);
    showIssues([{ module: "m", severity: "error", title: "Config: .eslintignore", message: "gone", file: ".eslintignore", line: 3 }]);
    expect(clack.log.error.mock.calls[1]?.[0]).toContain(".eslintignore:3");
  });

  test("showFixes lists grouped fixes, or says there are none", () => {
    showFixes(collectIssues(failing));
    expect(clack.note.mock.calls[0]?.[0]).toContain("Create .gitignore");
    expect(clack.note.mock.calls[0]?.[1]).toBe("Recommended fixes");
    showFixes([{ module: "m", severity: "info", title: "t", message: "m" }]);
    expect(clack.log.info).toHaveBeenCalledWith(expect.stringContaining("No automatic recommendations"));
  });

  test("showFixes shows a repeat count", () => {
    const i = { module: "m", severity: "warning" as const, title: "t", message: "m", recommendation: "same" };
    showFixes([i, i]);
    expect(clack.note.mock.calls[0]?.[0]).toContain("×2");
  });
});

describe("promptNextStep / promptSaveReport", () => {
  test("promptNextStep returns the choice, or null when cancelled", async () => {
    clack.select.mockResolvedValueOnce("ai");
    expect(await promptNextStep(true)).toBe("ai");
    expect(clack.select.mock.calls[0]?.[0].message).toContain("Issues found");
    clack.select.mockResolvedValueOnce("CANCEL");
    expect(await promptNextStep(false)).toBeNull();
    expect(clack.select.mock.calls[1]?.[0].message).toBe("Anything else?");
  });

  test("promptNextStep only offers 'Show all issues' when something is still hidden", async () => {
    clack.select.mockResolvedValue("done");
    const values = (): string[] => clack.select.mock.calls.at(-1)?.[0].options.map((o: { value: string }) => o.value);
    await promptNextStep(true, 3);
    expect(values()).toContain("details");
    expect(clack.select.mock.calls.at(-1)?.[0].options.find((o: { value: string }) => o.value === "details").hint).toContain("3 more");
    await promptNextStep(true, 0);
    expect(values()).not.toContain("details");
    expect(values()).toEqual(["fixes", "ai", "save", "rerun", "done"]);
  });

  test("promptSaveReport writes the chosen format to the chosen path", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "muraqib-save-"));
    const target = path.join(dir, "out.json");
    clack.select.mockResolvedValue("json");
    clack.text.mockResolvedValue(target);
    expect(await promptSaveReport(failing)).toBe(target);
    expect(JSON.parse(fs.readFileSync(target, "utf8")).summary.error).toBe(1);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("promptSaveReport defaults the file extension to the format and validates the path", async () => {
    clack.select.mockResolvedValue("CANCEL");
    expect(await promptSaveReport(failing)).toBeNull();
    clack.select.mockResolvedValue("csv");
    clack.text.mockResolvedValue("CANCEL");
    expect(await promptSaveReport(failing)).toBeNull();
    const options = clack.text.mock.calls[0]?.[0];
    expect(options.initialValue).toBe("muraqib-report.csv");
    expect(options.validate("")).toMatch(/path/);
    expect(options.validate(undefined)).toMatch(/path/);
    expect(options.validate("x")).toBeUndefined();
  });
});

describe("runInteractiveSession", () => {
  const base: InteractiveAuditOptions = { projectRoot: "/proj" };

  test("asks scope, scans and URL, runs the audit with those choices and finishes on 'done'", async () => {
    clack.select.mockResolvedValueOnce("security").mockResolvedValueOnce("done");
    clack.multiselect.mockResolvedValue(["osv"]);
    clack.text.mockResolvedValue("http://localhost:3000");
    const audit = vi.fn().mockResolvedValue(failing);

    const outcome = await runInteractiveSession(base, audit);

    expect(audit).toHaveBeenCalledWith({ osv: true, docker: false, aiAdvisory: false, projectRoot: "/proj", modules: ["security", "docker"], securityUrl: "http://localhost:3000" });
    expect(outcome).toEqual({ cancelled: false, report: failing });
    expect(clack.spinner.start).toHaveBeenCalledWith("Running security, docker...");
    expect(clack.outro).toHaveBeenCalledWith(expect.stringContaining("Failed"));
  });

  test("a clean report skips the next-step menu", async () => {
    clack.select.mockResolvedValueOnce("full");
    clack.multiselect.mockResolvedValue([]);
    clack.text.mockResolvedValue("");
    const outcome = await runInteractiveSession(base, vi.fn().mockResolvedValue(clean));
    expect(outcome).toEqual({ cancelled: false, report: clean });
    expect(clack.select).toHaveBeenCalledTimes(1);
    expect(clack.spinner.start).toHaveBeenCalledWith("Running all audit modules...");
    expect(clack.outro).toHaveBeenCalledWith(expect.stringContaining("Passed"));
  });

  test("skips prompts that flags already answered", async () => {
    const audit = vi.fn().mockResolvedValue(clean);
    await runInteractiveSession({ projectRoot: "/proj", modules: ["image"], osv: true, securityUrl: "http://x.test" }, audit);
    expect(clack.select).not.toHaveBeenCalled();
    expect(clack.multiselect).not.toHaveBeenCalled();
    expect(clack.text).not.toHaveBeenCalled();
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ modules: ["image"], osv: true, securityUrl: "http://x.test" }));
  });

  test("does not ask for a URL when the chosen modules exclude security", async () => {
    clack.select.mockResolvedValueOnce("performance");
    clack.multiselect.mockResolvedValue([]);
    await runInteractiveSession(base, vi.fn().mockResolvedValue(clean));
    expect(clack.text).not.toHaveBeenCalled();
  });

  test("next steps: fixes, details, AI hand-off and save, then done", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "muraqib-session-"));
    const target = path.join(dir, "r.html");
    clack.select
      .mockResolvedValueOnce("config") // scope
      .mockResolvedValueOnce("fixes")
      .mockResolvedValueOnce("details")
      .mockResolvedValueOnce("ai")
      .mockResolvedValueOnce("save")
      .mockResolvedValueOnce("html") // save format
      .mockResolvedValueOnce("done");
    clack.multiselect.mockResolvedValue([]);
    clack.text.mockResolvedValue(target);

    await runInteractiveSession({ projectRoot: "/proj", securityUrl: "http://x.test" }, vi.fn().mockResolvedValue(failing));

    const titles = clack.note.mock.calls.map((c) => c[1]);
    expect(titles).toEqual(["Results", "Recommended fixes", "Paste this into your AI assistant"]);
    expect(fs.readFileSync(target, "utf8")).toContain("<html");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("the session offers 'Show all issues' only for the info items it did not list", async () => {
    clack.select.mockResolvedValueOnce("config").mockResolvedValueOnce("done");
    clack.multiselect.mockResolvedValue([]);
    await runInteractiveSession({ projectRoot: "/proj", securityUrl: "http://x.test" }, vi.fn().mockResolvedValue(failing));
    const menu = clack.select.mock.calls[1]?.[0].options as Array<{ value: string; hint?: string }>;
    expect(menu.find((o) => o.value === "details")?.hint).toContain("1 more"); // the single info issue
  });

  test("'Run another audit' returns to the scope prompt and audits again", async () => {
    clack.select
      .mockResolvedValueOnce("full")
      .mockResolvedValueOnce("rerun")
      .mockResolvedValueOnce("quality")
      .mockResolvedValueOnce("done");
    clack.multiselect.mockResolvedValue([]);
    clack.text.mockResolvedValue("");
    const audit = vi.fn().mockResolvedValue(failing);

    await runInteractiveSession(base, audit);

    expect(audit).toHaveBeenCalledTimes(2);
    expect(audit.mock.calls[1]?.[0].modules).toEqual(["async", "dependency", "dead-code"]);
    expect(clack.text).toHaveBeenCalledTimes(1); // security URL asked only once
  });

  test.each([
    ["scope", () => clack.select.mockResolvedValueOnce("CANCEL")],
    ["scans", () => { clack.select.mockResolvedValueOnce("full"); clack.multiselect.mockResolvedValueOnce("CANCEL"); }],
    ["security URL", () => { clack.select.mockResolvedValueOnce("full"); clack.multiselect.mockResolvedValueOnce([]); clack.text.mockResolvedValueOnce("CANCEL"); }],
    ["next step", () => { clack.select.mockResolvedValueOnce("config").mockResolvedValueOnce("CANCEL"); clack.multiselect.mockResolvedValue([]); }],
    ["save", () => { clack.select.mockResolvedValueOnce("config").mockResolvedValueOnce("save").mockResolvedValueOnce("CANCEL"); clack.multiselect.mockResolvedValue([]); }],
  ])("cancelling the %s prompt ends the session as cancelled", async (_name, arrange) => {
    arrange();
    const outcome = await runInteractiveSession(base, vi.fn().mockResolvedValue(failing));
    expect(outcome).toEqual({ cancelled: true });
  });

  test("an audit failure stops the spinner and propagates", async () => {
    clack.select.mockResolvedValueOnce("config");
    clack.multiselect.mockResolvedValue([]);
    await expect(runInteractiveSession(base, vi.fn().mockRejectedValue(new Error("boom")))).rejects.toThrow("boom");
    expect(clack.spinner.error).toHaveBeenCalled();
  });
});
