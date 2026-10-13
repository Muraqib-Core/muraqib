import { describe, expect, it } from "vitest";
import { toAuditOptions, type SettingsReader } from "../src/core/settings.js";
import { formatStatus } from "../src/core/status.js";
import { makeReport } from "./fixtures.js";

describe("formatStatus", () => {
  it("covers idle, running and failed", () => {
    expect(formatStatus({ kind: "idle" })).toMatchObject({ text: "$(shield) Muraqib", level: "none" });
    expect(formatStatus({ kind: "running" }).text).toContain("sync~spin");
    const failed = formatStatus({ kind: "failed", message: "no engine" });
    expect(failed).toMatchObject({ level: "error" });
    expect(failed.tooltip).toContain("no engine");
  });

  it("shows issue counts and error emphasis for blocking issues", () => {
    const view = formatStatus({ kind: "done", report: makeReport() });
    expect(view.text).toBe("$(error) 2 $(warning) 1 $(info) 1");
    expect(view.tooltip).toContain("4 issue(s) - 1 critical, 1 error, 1 warning, 1 info");
    expect(view.level).toBe("error");
  });

  it("uses warning emphasis for warnings only and none for info only", () => {
    const warn = makeReport({ summary: { total: 1, critical: 0, error: 0, warning: 1, info: 0 } });
    expect(formatStatus({ kind: "done", report: warn }).level).toBe("warning");
    const info = makeReport({ summary: { total: 1, critical: 0, error: 0, warning: 0, info: 1 } });
    expect(formatStatus({ kind: "done", report: info }).level).toBe("none");
  });

  it("shows a clean pass", () => {
    const clean = makeReport({ verdict: "pass", summary: { total: 0, critical: 0, error: 0, warning: 0, info: 0 } });
    expect(formatStatus({ kind: "done", report: clean }).text).toBe("$(pass) Muraqib: 0");
  });

  it("flags an unreliable (ok:false) audit instead of a clean result", () => {
    const view = formatStatus({
      kind: "done",
      report: makeReport({ ok: false, summary: { total: 0, critical: 0, error: 0, warning: 0, info: 0 } }),
    });
    expect(view.text).toContain("unreliable");
    expect(view.level).toBe("error");
    expect(view.tooltip).toContain("did not complete reliably");
  });
});

function reader(values: Record<string, unknown>): SettingsReader {
  return { get: (key) => values[key] };
}

describe("toAuditOptions", () => {
  it("maps valid settings", () => {
    expect(
      toAuditOptions(
        reader({ modules: [" security ", "memory"], osv: true, docker: true, securityUrl: " http://localhost:3000 ", failOnWarning: true, maxIssues: 50 }),
        "/p"
      )
    ).toEqual({
      projectRoot: "/p",
      modules: ["security", "memory"],
      securityUrl: "http://localhost:3000",
      osv: true,
      docker: true,
      failOnWarning: true,
      maxIssues: 50,
    });
  });

  it("falls back to defaults for missing or invalid values", () => {
    const options = toAuditOptions(
      reader({ modules: "security", osv: "yes", docker: 1, securityUrl: "javascript:alert(1)", failOnWarning: null, maxIssues: -4 }),
      "/p"
    );
    expect(options).toEqual({
      projectRoot: "/p",
      modules: undefined,
      securityUrl: undefined,
      osv: false,
      docker: false,
      failOnWarning: false,
      maxIssues: 500,
    });
  });

  it("filters non-string and blank modules and treats maxIssues 0 as unlimited", () => {
    const options = toAuditOptions(reader({ modules: ["", "  ", 5, "docker"], maxIssues: 0 }), "/p");
    expect(options.modules).toEqual(["docker"]);
    expect(options.maxIssues).toBeUndefined();
  });

  it("never enables the AI advisory", () => {
    expect(toAuditOptions(reader({ aiAdvisory: true }), "/p").aiAdvisory).toBeUndefined();
  });
});
