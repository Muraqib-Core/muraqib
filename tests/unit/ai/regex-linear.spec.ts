import { describe, expect, test } from "vitest";
import { isSensitiveValue } from "../../../src/ai/safe-metadata.js";
import { escapeHtml, isSafeUrl } from "../../../src/webview/render/escape.js";
import { renderInline } from "../../../src/webview/render/inline.js";

const LEGACY_TOKEN = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)\s]+\))/;
const LEGACY_LINK = /^\[([^\]]+)\]\(([^)\s]+)\)$/;

/** The pre-rewrite implementation, kept as a behavioral oracle. */
function legacyRender(text: string): string {
  return text
    .split(LEGACY_TOKEN)
    .map((part) => {
      if (part.length > 2 && part.startsWith("`") && part.endsWith("`")) {
        return `<code>${escapeHtml(part.slice(1, -1))}</code>`;
      }
      if (part.length > 4 && part.startsWith("**") && part.endsWith("**")) {
        return `<strong>${escapeHtml(part.slice(2, -2))}</strong>`;
      }
      const link = LEGACY_LINK.exec(part);
      if (link) {
        const [, label = "", href = ""] = link;
        if (isSafeUrl(href)) {
          return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`;
        }
      }
      return escapeHtml(part);
    })
    .join("");
}

const BIG = 100_000;
const LIMIT_MS = 1000;

function elapsed(fn: () => unknown): number {
  const start = performance.now();
  fn();
  return performance.now() - start;
}

describe("isSensitiveValue credentialed URL (linear)", () => {
  test("detects URLs with user:password", () => {
    expect(isSensitiveValue("postgres://user:pass@host/db")).toBe(true);
    expect(isSensitiveValue("https://:pw:x@host")).toBe(true);
    expect(isSensitiveValue("redis://u:p:q@host")).toBe(true);
  });

  test("ignores URLs without a password part", () => {
    expect(isSensitiveValue("https://example.com/path")).toBe(false);
    expect(isSensitiveValue("https://user@host")).toBe(false);
    expect(isSensitiveValue("https://user:@host")).toBe(false);
    expect(isSensitiveValue("https://host:8080/a@b")).toBe(false);
    expect(isSensitiveValue("not a url user:pass@host")).toBe(false);
  });

  test("handles adversarial input quickly", () => {
    expect(elapsed(() => isSensitiveValue(`http://${":".repeat(BIG)}`))).toBeLessThan(LIMIT_MS);
    expect(elapsed(() => isSensitiveValue(`http://${"a:".repeat(BIG / 2)}`))).toBeLessThan(
      LIMIT_MS
    );
    expect(elapsed(() => isSensitiveValue(`a${"+".repeat(BIG)}`))).toBeLessThan(LIMIT_MS);
  });
});

describe("isSensitiveValue JWT (linear)", () => {
  test("detects JWT-shaped values", () => {
    expect(isSensitiveValue("eyJh.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgN")).toBe(true);
    expect(isSensitiveValue("eyJhbGciOi.eyJzdWIi")).toBe(true);
    expect(isSensitiveValue("eyJh.eyJz.")).toBe(true);
    expect(isSensitiveValue("eyJh.eyJz.a.b/c+d=")).toBe(true);
  });

  test("rejects non-JWT values", () => {
    expect(isSensitiveValue("eyJhonly")).toBe(false);
    expect(isSensitiveValue("eyJh.")).toBe(false);
    expect(isSensitiveValue("eyJh..abc")).toBe(false);
    expect(isSensitiveValue("xyJh.abc.def")).toBe(false);
    expect(isSensitiveValue("eyJh.abc def")).toBe(false);
  });

  test("handles adversarial input quickly", () => {
    expect(elapsed(() => isSensitiveValue(`ey${"a".repeat(BIG)}!`))).toBeLessThan(LIMIT_MS);
    expect(elapsed(() => isSensitiveValue(`eya.${"a".repeat(BIG)}!`))).toBeLessThan(LIMIT_MS);
    expect(elapsed(() => isSensitiveValue(`eya.a${".".repeat(BIG)}!`))).toBeLessThan(LIMIT_MS);
  });
});

describe("renderInline tokenizer (linear)", () => {
  test("preserves rendering for valid and invalid markup", () => {
    expect(renderInline("`a` and `b`")).toBe("<code>a</code> and <code>b</code>");
    expect(renderInline("**x****y**")).toBe("<strong>x</strong><strong>y</strong>");
    expect(renderInline("[a](https://e.com)[b](https://f.com)")).toBe(
      '<a href="https://e.com" target="_blank" rel="noopener noreferrer">a</a><a href="https://f.com" target="_blank" rel="noopener noreferrer">b</a>'
    );
    expect(renderInline("[x](javascript:alert(1))")).toBe("[x](javascript:alert(1))");
    expect(renderInline("[x](java script)")).toBe("[x](java script)");
    expect(renderInline("[](https://e.com) `unclosed **bold* [a]( )")).toBe(
      "[](https://e.com) `unclosed **bold* [a]( )"
    );
    expect(renderInline("**a*b** <i>")).toBe("**a*b** &lt;i&gt;");
    expect(renderInline("[a [b](https://e.com)")).toBe(
      '<a href="https://e.com" target="_blank" rel="noopener noreferrer">a [b</a>'
    );
    expect(renderInline("")).toBe("");
  });

  test("matches the original regex-based renderer on random inputs", () => {
    const alphabet = ["`", "*", "[", "]", "(", ")", " ", "a", "h", "<"];
    let seed = 12345;
    const next = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed;
    };
    for (let n = 0; n < 20000; n++) {
      const len = next() % 16;
      let text = "";
      for (let c = 0; c < len; c++) text += alphabet[next() % alphabet.length] ?? "";
      expect(renderInline(text)).toBe(legacyRender(text));
    }
  });

  test("handles adversarial input quickly", () => {
    const inputs = [
      "[".repeat(BIG),
      "[a](".repeat(BIG / 4),
      "[a]".repeat(BIG / 3),
      "`".repeat(BIG),
      "** ".repeat(BIG / 3),
      "*a".repeat(BIG / 2),
      `[a](${"b".repeat(BIG)}`,
    ];
    for (const input of inputs) {
      expect(elapsed(() => renderInline(input))).toBeLessThan(LIMIT_MS);
    }
  });
});
