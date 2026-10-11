import type { Block, Card, UiLabels } from "../content/types.js";
import { escapeHtml } from "./escape.js";
import { renderInline } from "./inline.js";

function renderCard(card: Card): string {
  const tags = (card.tags ?? []).map((tag) => `<li>${escapeHtml(tag)}</li>`).join("");
  return (
    `<article class="card"><h4>${escapeHtml(card.title)}</h4><p>${renderInline(card.body)}</p>` +
    (tags ? `<ul class="chips">${tags}</ul>` : "") +
    `</article>`
  );
}

/** Render one content block to an HTML string. Exhaustive over `Block["kind"]`. */
export function renderBlock(block: Block, labels: Pick<UiLabels, "copy" | "copied">): string {
  switch (block.kind) {
    case "heading":
      return `<h${block.level}>${renderInline(block.text)}</h${block.level}>`;
    case "paragraph":
      return `<p>${renderInline(block.text)}</p>`;
    case "list":
      return `<ul>${block.items.map((item) => `<li>${renderInline(item)}</li>`).join("")}</ul>`;
    case "code":
      return (
        `<figure class="code"><figcaption><span>${escapeHtml(block.language)}</span>` +
        `<button type="button" class="copy" data-copy data-copied="${escapeHtml(labels.copied)}">${escapeHtml(labels.copy)}</button>` +
        `</figcaption><pre><code>${escapeHtml(block.code)}</code></pre></figure>`
      );
    case "table": {
      const head = block.headers.map((h) => `<th scope="col">${renderInline(h)}</th>`).join("");
      const body = block.rows
        .map((row) => `<tr>${row.map((cell) => `<td>${renderInline(cell)}</td>`).join("")}</tr>`)
        .join("");
      return `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
    }
    case "callout":
      return `<aside class="callout ${block.tone}" role="note"><p>${renderInline(block.text)}</p></aside>`;
    case "cards":
      return `<div class="cards">${block.cards.map(renderCard).join("")}</div>`;
  }
}
