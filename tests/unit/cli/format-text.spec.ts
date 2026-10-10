import { describe, it, expect } from "vitest";
import { formatText } from "../../../src/cli/formatters.js";
import type { AuditReport } from "../../../src/cli/types.js";

const base = {
  timestamp: 0,
  projectRoot: "/p",
  summary: { total: 1, critical: 0, high: 1, medium: 0, low: 0 },
  modules: {
    scan: {
      status: "issues",
      issues: [
        {
          code: "osv-lodash",
          severity: "error",
          title: "Dependency Problem: lodash",
          message: "Package 'lodash' (4.17.15) has 6 known vulnerabilities.",
          recommendation: "Upgrade lodash",
          location: { file: "package.json" },
          tags: ["osv"],
        },
      ],
    },
    "memory-guard": { status: "ok", issues: [] },
  },
} as unknown as AuditReport;

describe("formatText", () => {
  it("lists issue details under modules that have issues", () => {
    const out = formatText(base);
    expect(out).toContain("[error] Dependency Problem: lodash (package.json)");
    expect(out).toContain("6 known vulnerabilities");
    expect(out).toContain("→ Upgrade lodash");
  });

  it("omits the file when the title already names it", () => {
    const report = {
      ...base,
      modules: {
        cfg: {
          status: "issues",
          issues: [{ severity: "warning", title: "Configuration Issue: tsconfig.json", message: "m", location: { file: "tsconfig.json" } }],
        },
      },
    } as unknown as AuditReport;
    const out = formatText(report);
    expect(out).toContain("Configuration Issue: tsconfig.json\n");
    expect(out).not.toContain("tsconfig.json (tsconfig.json)");
    expect(out).not.toContain("(tsconfig.json)");
  });

  it("prints nothing extra for clean modules", () => {
    const clean = { ...base, modules: { "memory-guard": { status: "ok", issues: [] } } } as unknown as AuditReport;
    expect(formatText(clean)).not.toContain("→");
  });
});
