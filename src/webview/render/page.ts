import type { PageContent, SidebarGroup, TabContent } from "../content/types.js";
import { NOSCRIPT_STYLES, PAGE_STYLES } from "../assets/styles.js";
import { TABS_SCRIPT } from "../assets/tabs-script.js";
import { renderBlock } from "./blocks.js";
import { escapeHtml, isSafeUrl } from "./escape.js";

/** Options for {@link renderPage}. */
export interface RenderOptions {
  /** CSP nonce applied to the inline `<style>` and `<script>`; use the host's nonce in a webview. */
  nonce: string;
}

const NONCE_PATTERN = /^[A-Za-z0-9+/_=-]{8,}$/;
const TAB_ID_PATTERN = /^[a-z][a-z0-9-]*$/;

const LOGO_SVG =
  '<svg class="logo" viewBox="0 0 64 64" role="img" aria-label="Muraqib logo" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M32 5 10 13v17c0 14 9.5 24.5 22 29 12.5-4.5 22-15 22-29V13z"/>' +
  '<path d="M18 33c4-6.5 9-9.5 14-9.5S42 26.5 46 33c-4 6.5-9 9.5-14 9.5S22 39.5 18 33z"/>' +
  '<circle cx="32" cy="33" r="3.5" fill="currentColor" stroke="none"/></svg>';

function validate(content: PageContent, options: RenderOptions): void {
  if (!NONCE_PATTERN.test(options.nonce)) {
    throw new Error("Invalid CSP nonce: expected at least 8 base64/base64url characters");
  }
  if (content.tabs.length === 0) throw new Error("PageContent needs at least one tab");
  const seen = new Set<string>();
  for (const tab of content.tabs) {
    if (!TAB_ID_PATTERN.test(tab.id)) throw new Error(`Invalid tab id "${tab.id}": use a lowercase slug`);
    if (seen.has(tab.id)) throw new Error(`Duplicate tab id "${tab.id}"`);
    seen.add(tab.id);
  }
}

function renderTabButton(tab: TabContent, index: number): string {
  const selected = index === 0;
  return (
    `<button type="button" role="tab" id="tab-${tab.id}" data-tab="${tab.id}" aria-controls="panel-${tab.id}" ` +
    `aria-selected="${selected}" tabindex="${selected ? 0 : -1}">${escapeHtml(tab.title)}</button>`
  );
}

function renderPanel(tab: TabContent, index: number, content: PageContent): string {
  const body = tab.blocks.map((block) => renderBlock(block, content.labels)).join("");
  return (
    `<section role="tabpanel" class="panel" id="panel-${tab.id}" aria-labelledby="tab-${tab.id}" tabindex="0"` +
    `${index === 0 ? "" : " hidden"}>${body}</section>`
  );
}

function renderSidebar(groups: SidebarGroup[]): string {
  return groups
    .map((group) => {
      const rows = group.items
        .map((item) => {
          const value =
            item.href !== undefined && isSafeUrl(item.href)
              ? `<a href="${escapeHtml(item.href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.value)}</a>`
              : escapeHtml(item.value);
          return `<dt>${escapeHtml(item.label)}</dt><dd>${value}</dd>`;
        })
        .join("");
      return `<section><h2>${escapeHtml(group.title)}</h2><dl>${rows}</dl></section>`;
    })
    .join("");
}

/**
 * Render a complete, self-contained HTML document (inline CSS and JS, no network access).
 * A strict Content-Security-Policy is embedded, so the same string works from `file://`
 * and inside a VS Code webview.
 *
 * @throws Error when the nonce is malformed or the tab list is empty, duplicated or has bad ids.
 */
export function renderPage(content: PageContent, options: RenderOptions): string {
  validate(content, options);
  const { nonce } = options;
  const csp = `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; img-src data:`;
  const badges = content.badges.map((badge) => `<li>${escapeHtml(badge)}</li>`).join("");

  return (
    `<!DOCTYPE html><html lang="${escapeHtml(content.lang)}" dir="${content.dir}"><head>` +
    `<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<meta http-equiv="Content-Security-Policy" content="${csp}">` +
    `<title>${escapeHtml(content.name)}</title>` +
    `<style nonce="${nonce}">${PAGE_STYLES}</style>` +
    `<noscript><style nonce="${nonce}">${NOSCRIPT_STYLES}</style></noscript></head><body>` +
    `<a class="skip" href="#content">${escapeHtml(content.labels.skipToContent)}</a>` +
    `<div class="page"><header class="hero">${LOGO_SVG}<div>` +
    `<h1>${escapeHtml(content.name)}<span class="version">v${escapeHtml(content.version)}</span></h1>` +
    `<p class="tagline">${escapeHtml(content.tagline)}</p><ul class="chips">${badges}</ul></div></header>` +
    `<div class="layout"><main id="content"><nav class="tabs" role="tablist" aria-label="${escapeHtml(content.labels.tabsLabel)}">` +
    `${content.tabs.map(renderTabButton).join("")}</nav>` +
    `${content.tabs.map((tab, i) => renderPanel(tab, i, content)).join("")}</main>` +
    `<aside class="side">${renderSidebar(content.sidebar)}</aside></div></div>` +
    `<script nonce="${nonce}">${TABS_SCRIPT}</script></body></html>`
  );
}
