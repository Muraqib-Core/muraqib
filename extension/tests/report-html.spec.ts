import { describe, expect, it } from "vitest";
import { escapeHtml, isSafeUrl, isValidNonce } from "../src/core/escape.js";
import { getLabels } from "../src/core/labels.js";
import { renderPlaceholderHtml, renderReportHtml } from "../src/core/report-html.js";
import { NONCE, XSS_PAYLOADS, makeIssue, makeReport } from "./fixtures.js";

/** Strip the constant script and style blocks so assertions only see rendered markup. */
function markup(html: string): string {
  return html.replace(/<script nonce="[^"]+">[\s\S]*?<\/script>/g, "").replace(/<style nonce="[^"]+">[\s\S]*?<\/style>/g, "");
}

describe("escape helpers", () => {
  it("escapes HTML metacharacters", () => {
    expect(escapeHtml(`<a href="x" onclick='y'>&\``)).toBe("&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&#96;");
  });

  it("allows only http(s) URLs", () => {
    expect(isSafeUrl("https://example.com")).toBe(true);
    expect(isSafeUrl("http://localhost:3000")).toBe(true);
    expect(isSafeUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeUrl("data:text/html,x")).toBe(false);
    expect(isSafeUrl("not a url")).toBe(false);
  });

  it("validates nonces", () => {
    expect(isValidNonce(NONCE)).toBe(true);
    expect(isValidNonce("short")).toBe(false);
    expect(isValidNonce('abc"def12345')).toBe(false);
  });
});

describe("renderReportHtml structure", () => {
  const html = renderReportHtml(makeReport(), { nonce: NONCE, language: "en" });

  it("embeds a strict CSP with the nonce and no network access", () => {
    expect(html).toContain(`default-src 'none'`);
    expect(html).toContain(`script-src 'nonce-${NONCE}'`);
    expect(html).toContain(`style-src 'nonce-${NONCE}'`);
    expect(html).not.toMatch(/connect-src|unsafe-inline|unsafe-eval/);
    expect(html).not.toMatch(/(?:src|href)="https?:/);
    expect(html).not.toContain("<link");
    expect(html).not.toContain("<iframe");
    expect(html).not.toMatch(/\son[a-z]+=/i);
  });

  it("puts the nonce on the only script and style tags", () => {
    expect(html.match(/<script/g)).toHaveLength(1);
    expect(html.match(/<style/g)).toHaveLength(1);
    expect(html.match(new RegExp(`<(?:script|style) nonce="${NONCE}"`, "g"))).toHaveLength(2);
  });

  it("groups issues by severity in order critical, error, warning, info", () => {
    const section = html.slice(html.indexOf('id="h-sev"'), html.indexOf('id="h-mod"'));
    const order = ["sev-critical", "sev-error", "sev-warning", "sev-info"].map((c) => section.indexOf(`<details class="group ${c}"`));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("groups issues per module with scanner coverage and diagnostics", () => {
    const modules = html.slice(html.indexOf('id="h-mod"'));
    expect(modules).toContain("memory");
    expect(modules).toContain("security");
    expect(modules).toContain("<caption>Scanner coverage</caption>");
    expect(modules).toContain("osv");
    expect(modules).toContain("partial");
    expect(modules).toContain("package-lock.json");
    expect(modules).toContain("yarn.lock");
    expect(modules).toContain("registry unreachable");
  });

  it("renders open-file buttons only for issues that have a file", () => {
    const buttons = html.match(/data-action="open"/g) ?? [];
    expect(buttons.length).toBeGreaterThan(0);
    expect(html).toContain('data-file="src/a.ts" data-line="3" data-column="5"');
    expect(html).toContain('data-file="lib/b.ts" data-line="9"');
  });

  it("shows verdict, project root and truncation notice", () => {
    const truncated = renderReportHtml(makeReport({ truncated: 7 }), { nonce: NONCE });
    expect(truncated).toContain("7 more issues were hidden");
    expect(html).toContain("/work/project");
    expect(html).toContain('class="verdict fail"');
    expect(renderReportHtml(makeReport({ verdict: "pass", issues: [] }), { nonce: NONCE })).toContain('class="verdict pass"');
  });

  it("shows an empty state when there are no issues", () => {
    const empty = renderReportHtml(makeReport({ issues: [], modules: [], summary: { total: 0, critical: 0, error: 0, warning: 0, info: 0 } }), {
      nonce: NONCE,
    });
    expect(empty).toContain("No issues found");
  });

  it("shows an alert banner when the audit did not run (ok:false)", () => {
    const failed = renderReportHtml(makeReport({ ok: false, error: "boom <b>", issues: [] }), { nonce: NONCE });
    expect(failed).toContain('role="alert"');
    expect(failed).toContain("boom &lt;b&gt;");
  });

  it("marks the page busy and disables the run button", () => {
    const busy = renderReportHtml(makeReport(), { nonce: NONCE, busy: true });
    expect(busy).toContain('<body class="busy">');
    expect(busy).toContain('data-action="run" disabled');
  });

  it("rejects malformed nonces", () => {
    expect(() => renderReportHtml(makeReport(), { nonce: "x" })).toThrow(/nonce/);
    expect(() => renderReportHtml(makeReport(), { nonce: `a"b'c<d>12345678` })).toThrow(/nonce/);
    expect(() => renderPlaceholderHtml({ nonce: "bad" })).toThrow(/nonce/);
  });

  it("tolerates malformed engine values without throwing", () => {
    const odd = makeIssue({ severity: "weird" as never, line: -3, column: 2.5, tags: undefined as never, recommendation: "" });
    const html2 = markup(renderReportHtml(makeReport({ issues: [odd] }), { nonce: NONCE }));
    expect(html2).toContain("sev-info");
    expect(html2).not.toContain("data-line");
    expect(html2).not.toContain("data-column");
  });
});

describe("RTL and Arabic", () => {
  it("renders Arabic labels with dir=rtl and isolates paths as LTR", () => {
    const html = renderReportHtml(makeReport(), { nonce: NONCE, language: "ar" });
    expect(html).toContain('<html lang="ar" dir="rtl">');
    expect(html).toContain("تقرير تدقيق مراقب");
    expect(html).toContain("حرجة");
    expect(html).toContain('<bdi dir="ltr">src/a.ts:3:5</bdi>');
    expect(html).toContain('dir="auto"');
  });

  it("handles Arabic issue text safely", () => {
    const html = renderReportHtml(makeReport({ issues: [makeIssue({ message: "تم العثور على سر <b>مكشوف</b>" })] }), {
      nonce: NONCE,
      language: "ar-SA",
    });
    expect(html).toContain("تم العثور على سر &lt;b&gt;مكشوف&lt;/b&gt;");
  });

  it("falls back to English for other languages", () => {
    expect(getLabels("fr").dir).toBe("ltr");
    expect(getLabels(undefined).lang).toBe("en");
    expect(getLabels("AR_eg").lang).toBe("ar");
    expect(renderReportHtml(makeReport(), { nonce: NONCE, language: "fr" })).toContain('<html lang="en" dir="ltr">');
  });
});

describe("XSS resistance", () => {
  it.each(XSS_PAYLOADS)("escapes %j in every dynamic field", (payload) => {
    const issue = makeIssue({
      title: payload,
      message: payload,
      recommendation: payload,
      code: payload,
      module: payload,
      file: payload,
      tags: [payload],
    });
    const report = makeReport({
      issues: [issue],
      projectRoot: payload,
      error: payload,
      ok: false,
      modules: [
        {
          name: payload,
          status: payload as never,
          issueCount: 1,
          scan: {
            mode: "build",
            exitCode: 0,
            hasBlockingIssues: false,
            scannerCoverage: [{ scanner: payload, status: payload as never, scannedInputs: [payload], skippedInputs: [payload], diagnostics: [payload] }],
          },
        },
      ],
    });
    const body = markup(renderReportHtml(report, { nonce: NONCE }));
    expect(body).not.toContain("<script");
    expect(body).not.toContain("<img");
    expect(body).not.toContain("</style>");

    // No attribute value can be broken out of: every quote inside payloads is entity-encoded.
    for (const tag of body.match(/<[^>]+>/g) ?? []) {
      expect(tag.replace(/"[^"]*"/g, "\"\"")).not.toMatch(/\son[a-z]+\s*=/i);
      expect((tag.match(/"/g) ?? []).length % 2).toBe(0);
    }
  });

  it("keeps a hostile file path inert inside data-file and the label", () => {
    const file = `"><script>alert(1)</script>`;
    const html = markup(renderReportHtml(makeReport({ issues: [makeIssue({ file })] }), { nonce: NONCE }));
    expect(html).toContain(`data-file="&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;"`);
    expect(html).not.toContain("<script>alert(1)");
  });

  it("does not let a payload forge the nonce", () => {
    const html = renderReportHtml(makeReport({ issues: [makeIssue({ message: `<script nonce="${NONCE}">evil()</script>` })] }), { nonce: NONCE });
    expect(html.match(/<script/g)).toHaveLength(1);
  });

  it("constant script contains no report data and uses no dynamic code", () => {
    const html = renderReportHtml(makeReport({ issues: [makeIssue({ message: "UNIQUE-MARKER-123" })] }), { nonce: NONCE });
    const script = /<script nonce="[^"]+">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? "";
    expect(script).not.toContain("UNIQUE-MARKER-123");
    expect(script).not.toMatch(/eval\(|new Function|innerHTML|document\.write|fetch\(|XMLHttpRequest/);
  });
});

describe("renderPlaceholderHtml", () => {
  it("shows the empty state with a run button", () => {
    const html = renderPlaceholderHtml({ nonce: NONCE });
    expect(html).toContain("No audit has run yet");
    expect(html).toContain('data-action="run"');
  });

  it("shows the running state", () => {
    const html = renderPlaceholderHtml({ nonce: NONCE, busy: true, language: "ar" });
    expect(html).toContain("جارٍ التدقيق");
    expect(html).toContain('class="busy"');
  });
});
