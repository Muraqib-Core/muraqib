import { escapeHtml, isSafeUrl } from "./escape.js";

const WHITESPACE = /\s/;
const LINK = /^\[([^\]]+)\]\(([^)\s]+)\)$/;

/**
 * Memoised forward search for a character. Once a search from `from` finds `idx`
 * (or nothing), later searches that start inside the scanned range reuse it, so
 * the total work across all calls stays linear.
 */
function makeFinder(text: string, ch: string): (from: number) => number {
  let cachedFrom = -1;
  let cachedIdx = -2;
  return (from) => {
    if (cachedIdx !== -2 && from >= cachedFrom && (cachedIdx === -1 || from <= cachedIdx)) {
      return cachedIdx;
    }
    cachedFrom = from;
    cachedIdx = text.indexOf(ch, from);
    return cachedIdx;
  };
}

/**
 * Split text into alternating plain / token parts, where a token is
 * `code`, **bold** or [label](url) (same grammar and precedence as the former
 * regex split, but a single linear pass).
 */
function splitInline(text: string): string[] {
  const findTick = makeFinder(text, "`");
  const findStar = makeFinder(text, "*");
  const findClose = makeFinder(text, "]");
  let runFrom = -1;
  let runEnd = -1;
  const hrefEnd = (from: number): number => {
    if (runEnd !== -1 && from >= runFrom && from <= runEnd) return runEnd;
    let k = from;
    while (k < text.length && text[k] !== ")" && !WHITESPACE.test(text[k] ?? "")) k++;
    runFrom = from;
    runEnd = k;
    return k;
  };

  const parts: string[] = [];
  let plainStart = 0;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    let end = -1; // exclusive end of a token starting at i
    if (ch === "`") {
      const j = findTick(i + 1);
      if (j > i + 1) end = j + 1;
    } else if (ch === "*" && text[i + 1] === "*") {
      const j = findStar(i + 2);
      if (j > i + 2 && text[j + 1] === "*") end = j + 2;
    } else if (ch === "[") {
      const j = findClose(i + 1);
      if (j > i + 1 && text[j + 1] === "(") {
        const k = hrefEnd(j + 2);
        if (k > j + 2 && text[k] === ")") end = k + 1;
      }
    }
    if (end === -1) {
      i++;
      continue;
    }
    parts.push(text.slice(plainStart, i), text.slice(i, end));
    plainStart = end;
    i = end;
  }
  parts.push(text.slice(plainStart));
  return parts;
}

/**
 * Render the small inline markup used in content strings to safe HTML.
 * Supports `code`, **bold** and [label](https://url); all other text is escaped verbatim.
 */
export function renderInline(text: string): string {
  return splitInline(text)
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
