import { beforeEach, describe, expect, test, vi } from "vitest";

const { collect } = vi.hoisted(() => ({ collect: vi.fn() }));
vi.mock("../../../src/orchestrator/collect-results.js", () => ({ collectAuditResults: collect }));

import { runAuditForAgent } from "../../../src/agent/index.js";
import { formatReport } from "../../../src/cli/formatters.js";
import type { AuditReport } from "../../../src/cli/types.js";
import type { AuditResult } from "../../../src/core/types.js";

const SEVERITIES = ["critical", "error", "warning", "info"] as const;

const classic: AuditReport = {
  timestamp: 0,
  projectRoot: "/p",
  summary: { total: 4, critical: 1, error: 1, warning: 1, info: 1 },
  modules: {},
};

beforeEach(() => collect.mockReset());

describe("severity vocabulary is shared by every report", () => {
  test("classic JSON summary uses the same keys as the AgentReport summary", async () => {
    const results: AuditResult[] = [
      {
        status: "issues",
        module: "m",
        message: "",
        timestamp: 1,
        duration: 1,
        issues: SEVERITIES.map((severity) => ({ code: "C", severity, title: "t", message: "m", tags: [] })),
      },
    ];
    collect.mockResolvedValue(results);

    const agent = await runAuditForAgent({ projectRoot: "/p" });
    const classicKeys = Object.keys(JSON.parse(formatReport(classic, "json")).summary).sort();

    expect(classicKeys).toEqual(Object.keys(agent.summary).sort());
    expect(classicKeys).toEqual(["critical", "error", "info", "total", "warning"]);
  });

  test("text, html and csv label severities with the shared names only", () => {
    const text = formatReport(classic, "text");
    const html = formatReport(classic, "html");
    const csv = formatReport(classic, "csv");

    for (const label of ["Critical", "Error", "Warning", "Info"]) {
      expect(text).toContain(`${label}:`);
      expect(html).toContain(`<p>${label}</p>`);
      expect(csv).toContain(`Summary,${label},1`);
    }
    for (const retired of ["High", "Medium", "Low"]) {
      expect(text).not.toContain(retired);
      expect(html).not.toMatch(new RegExp(`<p>${retired}</p>|summary-card ${retired.toLowerCase()}`));
      expect(csv).not.toContain(retired);
    }
  });

  test("html styles every shared severity for cards and badges", () => {
    const html = formatReport(classic, "html");
    for (const severity of SEVERITIES) {
      expect(html).toContain(`.summary-card.${severity}`);
      expect(html).toContain(`.status-badge.${severity}`);
    }
  });
});
