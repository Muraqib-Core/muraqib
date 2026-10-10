import { describe, expect, test } from "vitest";
import {
  formatCsv,
  formatHtml,
  formatJson,
  formatReport,
  formatText,
} from "../../../src/cli/formatters.js";
import type { AuditReport } from "../../../src/cli/types.js";

const report = (modules: Record<string, unknown> = {}): AuditReport =>
  ({
    timestamp: 0,
    projectRoot: "/proj",
    summary: { total: 4, critical: 1, high: 1, medium: 1, low: 1 },
    modules,
  }) as AuditReport;

describe("formatters", () => {
  test("formatJson round-trips the report", () => {
    expect(JSON.parse(formatJson(report()))).toMatchObject({ projectRoot: "/proj" });
  });

  test("formatCsv lists the severity counts", () => {
    expect(formatCsv(report()).split("\n")).toEqual([
      "Module,Severity,Count",
      "Summary,Critical,1",
      "Summary,High,1",
      "Summary,Medium,1",
      "Summary,Low,1",
    ]);
  });

  test("formatHtml renders a full document with the project root", () => {
    const html = formatHtml(report({ a: { status: "ok", issues: [] } }));
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain("Muraqib Audit Report");
    expect(html).toContain("/proj");
  });

  test("formatReport dispatches on format and defaults to text", () => {
    const r = report();
    expect(formatReport(r, "json")).toBe(formatJson(r));
    expect(formatReport(r, "html")).toBe(formatHtml(r));
    expect(formatReport(r, "csv")).toBe(formatCsv(r));
    expect(formatReport(r, "text")).toBe(formatText(r));
    expect(formatReport(r, "other" as never)).toBe(formatText(r));
  });

  describe("formatText", () => {
    test("omits the module section when there are no modules", () => {
      expect(formatText(report())).not.toContain("Module Results");
    });

    test("shows module status and issue details", () => {
      const text = formatText(
        report({
          withStatus: {
            status: "issues",
            issues: [
              {
                severity: "critical",
                title: "Leak",
                message: "bad",
                recommendation: "fix it",
                location: { file: "a.ts", line: 3 },
              },
            ],
          },
          noStatusIssues: { issues: [{ severity: "weird", title: "T", message: "M" }] },
          noStatusClean: { issues: [] },
          unknownShape: {},
          notAnObject: "text",
        })
      );
      expect(text).toContain("issues withStatus");
      expect(text).toContain("🔴 [critical] Leak (a.ts:3)");
      expect(text).toContain("→ fix it");
      expect(text).toContain("⚠️ noStatusIssues");
      expect(text).toContain("• [weird] T");
      expect(text).toContain("✅ noStatusClean");
      expect(text).toContain("❓ unknownShape");
      expect(text).not.toContain("notAnObject");
    });

    test("hides the file when the title already contains it and no line is given", () => {
      const text = formatText(
        report({
          m: {
            status: "ok",
            issues: [
              { severity: "info", title: "Problem in a.ts", message: "m", location: { file: "a.ts" } },
              { severity: "info", title: "Other", message: "m", location: { file: "b.ts" } },
              "not an issue",
              { severity: 1 },
            ],
          },
          bad: { status: "ok", issues: "nope" },
        })
      );
      expect(text).toContain("Problem in a.ts\n");
      expect(text).toContain("Other (b.ts)");
    });
  });
});
