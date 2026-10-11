import { escapeHtml, isSafeUrl } from "./escape.js";

const INLINE_TOKEN = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)\s]+\))/;
const LINK = /^\[([^\]]+)\]\(([^)\s]+)\)$/;

/**
 * Render the small inline markup used in content strings to safe HTML.
 * Supports `code`, **bold** and [label](https://url); all other text is escaped verbatim.
 */
export function renderInline(text: string): string {
  return text
    .split(INLINE_TOKEN)
    .map((part) => {
      if (part.length > 2 && part.startsWith("`") && part.endsWith("`")) {
        return `<code>${escapeHtml(part.slice(1, -1))}</code>`;
      }
      if (part.length > 4 && part.startsWith("**") && part.endsWith("**")) {
        return `<strong>${escapeHtml(part.slice(2, -2))}</strong>`;
      }
      const link = LINK.exec(part);
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
