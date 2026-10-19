import { describe, expect, it } from "vitest";
import { escapeHtml, isSafeUrl } from "../../../../src/webview/render/escape.js";

describe("escape branches", () => {
  it("escapes all special characters and leaves plain text alone", () => {
    expect(escapeHtml(`<a href="x">&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;");
    expect(escapeHtml("plain")).toBe("plain");
  });

  it("accepts only http(s) URLs", () => {
    expect(isSafeUrl("https://example.com")).toBe(true);
    expect(isSafeUrl("http://example.com")).toBe(true);
    expect(isSafeUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeUrl("data:text/html,x")).toBe(false);
    expect(isSafeUrl("not a url")).toBe(false);
  });
});
