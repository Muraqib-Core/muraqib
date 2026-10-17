import { describe, expect, test } from "vitest";
import {
  findingsFromReport,
  formatMarkdown,
  scoreBadge,
  scorecardFromReport,
} from "../../../src/cli/scorecard-markdown.js";
import { formatReport } from "../../../src/cli/formatters.js";
import type { AuditReport } from "../../../src/cli/types.js";

const GOLDEN = (name: string): string => `../../golden/scorecard/${name}.md`;

type RawIssue = Record<string, unknown>;

const issue = (severity: string, title: string, extra: RawIssue = {}): RawIssue => ({
  code: "C",
  severity,
  title,
  message: "m",
  tags: [],
  ...extra,
});

const report = (modules: Record<string, unknown>): AuditReport => ({
  timestamp: 1_700_000_000_000,
  projectRoot: "/work/secret-project",
  summary: { total: 0, critical: 0, error: 0, warning: 0, info: 0 },
  modules,
});

const result = (module: string, issues: RawIssue[]): unknown => ({ module, status: "issues", message: "", issues });

const CLEAN = report({
  "memory-guard": result("memory-guard", []),
  "security-guard": result("security-guard", []),
});

const WITH_CRITICAL = report({
  "security-guard": result("security-guard", [
    issue("critical", "Hardcoded API key", { location: { file: "src/config.ts", line: 12 } }),
    issue("error", "Missing CSP header"),
  ]),
  "dependency-guard": result("dependency-guard", [issue("warning", "Circular dependency a -> b -> a")]),
  "memory-guard": result("memory-guard", []),
});

const MIXED = report({
  "security-guard": result("security-guard", [issue("error", "Missing HSTS header")]),
  "scan": result("scan", [
    issue("info", "Outdated lodash", { level: "medium", category: "compatibility", dependencyProblem: { package: "lodash" } }),
    issue("info", "Minor style note", { level: "low", category: "configuration" }),
    issue("info", "FYI only"),
  ]),
  "async-guard": result("async-guard", [issue("warning", "Floating promise", { location: { file: "src/a.ts" } })]),
  "ai-advisory": { advisory: "plain text, not an audit result" },
});

describe("formatMarkdown golden files", () => {
  test("clean project", async () => {
    await expect(formatMarkdown(CLEAN)).toMatchFileSnapshot(GOLDEN("clean"));
  });

  test("critical finding caps the score", async () => {
    await expect(formatMarkdown(WITH_CRITICAL)).toMatchFileSnapshot(GOLDEN("critical-capped"));
  });

  test("mixed severities, scan-layer levels and domains", async () => {
    await expect(formatMarkdown(MIXED)).toMatchFileSnapshot(GOLDEN("mixed"));
  });

  test("long blocking-findings lists are truncated", async () => {
    const many = Array.from({ length: 25 }, (_, i) => issue("error", `Finding ${String(i + 1).padStart(2, "0")}`));
    await expect(formatMarkdown(report({ "security-guard": result("security-guard", many) }))).toMatchFileSnapshot(
      GOLDEN("truncated")
    );
  });
});

describe("formatMarkdown", () => {
  test("is deterministic and contains no timestamps or absolute project paths", () => {
    const first = formatMarkdown(WITH_CRITICAL);
    expect(formatMarkdown({ ...WITH_CRITICAL, timestamp: 42, projectRoot: "/elsewhere" })).toBe(first);
    expect(first).not.toContain("/work/secret-project");
    expect(first.endsWith("\n")).toBe(true);
  });

  test("states the hard cap and the score it replaced", () => {
    const md = formatMarkdown(WITH_CRITICAL);
    expect(md).toContain("Score capped at 59");
    expect(md).toContain("**Overall score: 59/100 (grade F)**");
    expect(md).toContain("![Security Score](https://img.shields.io/badge/security%20score-59%2F100%20(F)-red)");
  });

  test("reports the evaluated modules so a partial run is not mistaken for a full audit", () => {
    expect(formatMarkdown(CLEAN)).toContain("Modules evaluated: `memory-guard`, `security-guard`.");
    expect(formatMarkdown(report({}))).toContain("No audit modules were evaluated.");
  });

  test("escapes untrusted finding text so it cannot inject HTML or break the layout", () => {
    const md = formatMarkdown(
      report({
        "security-guard": result("security-guard", [issue("critical", "<img src=x onerror=alert(1)> | `rm -rf`\n*bold*")]),
      })
    );
    expect(md).not.toContain("<img");
    expect(md).toContain("&lt;img src=x onerror=alert(1)&gt; \\| \\`rm -rf\\` \\*bold\\*");
    expect(md.split("\n").filter((l) => l.startsWith("- **Critical**"))).toHaveLength(1);
  });

  test("is wired to the md output format", () => {
    expect(formatReport(CLEAN, "md")).toBe(formatMarkdown(CLEAN));
  });
});

describe("scoreBadge", () => {
  test.each([
    [100, "A", "brightgreen"], [85, "B", "green"], [75, "C", "yellowgreen"], [65, "D", "yellow"], [10, "F", "red"],
  ] as const)("score %i is %s / %s", (score, grade, color) => {
    expect(scoreBadge({ score, grade })).toContain(`${score}%2F100%20(${grade})-${color})`);
  });
});

describe("findingsFromReport", () => {
  test("classifies issues using their module, level and category", () => {
    const { findings, modules } = findingsFromReport(MIXED);
    expect(modules).toEqual(["security-guard", "scan", "async-guard"]);
    expect(findings.map(({ severity, domain, module }) => ({ severity, domain, module }))).toEqual([
      { severity: "high", domain: "security", module: "security-guard" },
      { severity: "medium", domain: "dependencies", module: "scan" },
      { severity: "low", domain: "code-quality", module: "scan" },
      { severity: "info", domain: "code-quality", module: "scan" },
      { severity: "medium", domain: "code-quality", module: "async-guard" },
    ]);
  });

  test("tolerates malformed modules and issues from third-party guards", () => {
    const { findings, modules } = findingsFromReport(
      report({
        a: null,
        b: "text",
        c: { issues: "not an array" },
        d: { issues: [null, 3, { severity: "bogus" }, { severity: "warning" }, { severity: "error", tags: [1, "security"], title: 5, location: { file: 7, line: "x" } }] },
      })
    );
    expect(modules).toEqual(["d"]);
    expect(findings).toEqual([
      { severity: "medium", domain: "code-quality", module: "d", title: "Untitled finding" },
      { severity: "high", domain: "security", module: "d", title: "Untitled finding" },
    ]);
  });

  test("falls back to the issue code when there is no title", () => {
    const { findings } = findingsFromReport(report({ m: { issues: [{ severity: "error", code: "SOME_CODE" }] } }));
    expect(findings[0]?.title).toBe("SOME_CODE");
  });

  test("scorecardFromReport scores the extracted findings", () => {
    expect(scorecardFromReport(WITH_CRITICAL).scorecard.score).toBe(59);
    expect(scorecardFromReport(CLEAN).scorecard.score).toBe(100);
  });
});
