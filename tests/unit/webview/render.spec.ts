import { describe, expect, test } from "vitest";
import { escapeHtml, isSafeUrl } from "../../../src/webview/render/escape.js";
import { renderInline } from "../../../src/webview/render/inline.js";
import { renderBlock } from "../../../src/webview/render/blocks.js";
import { renderPage } from "../../../src/webview/render/page.js";
import type { PageContent } from "../../../src/webview/content/types.js";

const LABELS = { copy: "Copy", copied: "Copied" };

describe("escapeHtml / isSafeUrl", () => {
  test("escapes every HTML-significant character", () => {
    expect(escapeHtml(`<a href="x" onclick='y'>&</a>`)).toBe(
      "&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;"
    );
  });

  test("accepts only absolute http(s) URLs", () => {
    expect(isSafeUrl("https://example.com/a")).toBe(true);
    expect(isSafeUrl("http://example.com")).toBe(true);
    expect(isSafeUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeUrl("data:text/html,<script>")).toBe(false);
    expect(isSafeUrl("/relative")).toBe(false);
  });
});

describe("renderInline", () => {
  test("renders code, bold and safe links", () => {
    expect(renderInline("Run `npm test` for **all** [docs](https://example.com)")).toBe(
      'Run <code>npm test</code> for <strong>all</strong> <a href="https://example.com" target="_blank" rel="noopener noreferrer">docs</a>'
    );
  });

  test("escapes raw HTML in plain text and inside code", () => {
    expect(renderInline("<img src=x onerror=alert(1)>")).toBe("&lt;img src=x onerror=alert(1)&gt;");
    expect(renderInline("`<b>`")).toBe("<code>&lt;b&gt;</code>");
  });

  test("never emits a link for an unsafe scheme", () => {
    const html = renderInline("[click](javascript:alert(1))");
    expect(html).not.toContain("<a ");
    expect(html).toContain("[click](javascript:alert(1))");
  });

  test("leaves unmatched markers as text", () => {
    expect(renderInline("a ` b ** c")).toBe("a ` b ** c");
  });
});

describe("renderBlock", () => {
  test("heading, paragraph and list", () => {
    expect(renderBlock({ kind: "heading", level: 3, text: "Hi" }, LABELS)).toBe("<h3>Hi</h3>");
    expect(renderBlock({ kind: "paragraph", text: "a **b**" }, LABELS)).toBe("<p>a <strong>b</strong></p>");
    expect(renderBlock({ kind: "list", items: ["x", "`y`"] }, LABELS)).toBe(
      "<ul><li>x</li><li><code>y</code></li></ul>"
    );
  });

  test("code block escapes content and carries copy labels", () => {
    const html = renderBlock({ kind: "code", language: "ts", code: "a < b && c" }, LABELS);
    expect(html).toContain("<code>a &lt; b &amp;&amp; c</code>");
    expect(html).toContain('data-copied="Copied"');
    expect(html).toContain(">Copy</button>");
  });

  test("table renders scoped headers and inline cells", () => {
    const html = renderBlock({ kind: "table", headers: ["Flag"], rows: [["`-p`"]] }, LABELS);
    expect(html).toContain('<th scope="col">Flag</th>');
    expect(html).toContain("<td><code>-p</code></td>");
  });

  test("callout exposes its tone and note role", () => {
    const html = renderBlock({ kind: "callout", tone: "warning", text: "Careful" }, LABELS);
    expect(html).toContain('class="callout warning"');
    expect(html).toContain('role="note"');
  });

  test("cards render chips only when tags exist", () => {
    const html = renderBlock(
      {
        kind: "cards",
        cards: [{ title: "A", body: "b", tags: ["<t>"] }, { title: "B", body: "c" }],
      },
      LABELS
    );
    expect(html).toContain('<ul class="chips"><li>&lt;t&gt;</li></ul>');
    expect(html.match(/class="chips"/g)).toHaveLength(1);
  });
});

function content(overrides: Partial<PageContent> = {}): PageContent {
  return {
    lang: "en",
    dir: "ltr",
    name: "Demo <b>",
    tagline: "tag",
    version: "1.2.3",
    badges: ["one"],
    labels: { copy: "Copy", copied: "Copied", tabsLabel: "Sections", skipToContent: "Skip" },
    tabs: [
      { id: "a", title: "A", blocks: [{ kind: "paragraph", text: "alpha" }] },
      { id: "b-2", title: "B", blocks: [{ kind: "paragraph", text: "beta" }] },
    ],
    sidebar: [
      {
        title: "Links",
        items: [
          { label: "Repo", value: "GitHub", href: "https://example.com/r" },
          { label: "Bad", value: "Evil", href: "javascript:alert(1)" },
          { label: "Plain", value: "text" },
        ],
      },
    ],
    ...overrides,
  };
}

describe("renderPage", () => {
  const NONCE = "abcDEF123456_-==";

  test("renders an accessible tab list with only the first panel visible", () => {
    const html = renderPage(content(), { nonce: NONCE });
    expect(html).toContain('role="tablist" aria-label="Sections"');
    expect(html).toContain('id="tab-a" data-tab="a" aria-controls="panel-a" aria-selected="true" tabindex="0"');
    expect(html).toContain('id="tab-b-2" data-tab="b-2" aria-controls="panel-b-2" aria-selected="false" tabindex="-1"');
    expect(html).toMatch(/id="panel-a"[^>]*tabindex="0">/);
    expect(html).toMatch(/id="panel-b-2"[^>]* hidden>/);
  });

  test("embeds a strict CSP and applies the nonce to inline style and script", () => {
    const html = renderPage(content(), { nonce: NONCE });
    expect(html).toContain(`default-src 'none'; style-src 'nonce-${NONCE}'; script-src 'nonce-${NONCE}'`);
    expect(html).toContain(`<style nonce="${NONCE}">`);
    expect(html).toContain(`<script nonce="${NONCE}">`);
    expect(html).not.toMatch(/<script(?![^>]*nonce)/);
    expect(html).not.toMatch(/ style=|onclick=|onerror=/);
  });

  test("escapes content-controlled text and rejects unsafe sidebar links", () => {
    const html = renderPage(content(), { nonce: NONCE });
    expect(html).toContain("<title>Demo &lt;b&gt;</title>");
    expect(html).toContain('href="https://example.com/r"');
    expect(html).not.toContain("javascript:");
    expect(html).toContain("<dd>Evil</dd>");
  });

  test("honours language and direction for future RTL content", () => {
    const html = renderPage(content({ lang: "ar", dir: "rtl" }), { nonce: NONCE });
    expect(html).toContain('<html lang="ar" dir="rtl">');
  });

  test.each(["", "short", "has space in it", `"><script>`])("rejects the invalid nonce %j", (nonce) => {
    expect(() => renderPage(content(), { nonce })).toThrow(/nonce/i);
  });

  test("rejects empty, duplicated and malformed tab ids", () => {
    const tab = { id: "a", title: "A", blocks: [] };
    expect(() => renderPage(content({ tabs: [] }), { nonce: NONCE })).toThrow(/at least one tab/);
    expect(() => renderPage(content({ tabs: [tab, tab] }), { nonce: NONCE })).toThrow(/Duplicate/);
    expect(() => renderPage(content({ tabs: [{ ...tab, id: 'x"y' }] }), { nonce: NONCE })).toThrow(/Invalid tab id/);
  });
});

describe("inline script", () => {
  test("is syntactically valid and self-contained", async () => {
    const { TABS_SCRIPT } = await import("../../../src/webview/assets/tabs-script.js");
    expect(() => new Function(TABS_SCRIPT)).not.toThrow();
    expect(TABS_SCRIPT).not.toMatch(/\b(fetch|XMLHttpRequest|eval)\b/);
  });
});
