/** Stylesheet for the documentation page. Logical properties keep the layout RTL-ready. */
export const PAGE_STYLES = `
:root {
  --bg: #ffffff; --surface: #f6f8fa; --border: #d0d7de; --text: #1f2328; --muted: #59636e;
  --accent: #0b5cad; --accent-soft: #e5f0fb; --code-bg: #f0f3f6;
  --tip: #1a7f37; --warning: #9a6700; --info: #0b5cad;
  --radius: 10px; --font: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color-scheme: light dark;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0d1117; --surface: #151b23; --border: #30363d; --text: #e6edf3; --muted: #9198a1;
    --accent: #58a6ff; --accent-soft: #14233a; --code-bg: #1b222c;
    --tip: #3fb950; --warning: #d29922; --info: #58a6ff;
  }
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; background: var(--bg); color: var(--text); font: 16px/1.6 var(--font); }
a { color: var(--accent); }
a:focus-visible, button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.skip { position: absolute; inset-inline-start: 8px; inset-block-start: -48px; background: var(--accent); color: var(--bg); padding: 8px 12px; border-radius: 6px; z-index: 10; }
.skip:focus { inset-block-start: 8px; }
.page { max-inline-size: 1120px; margin-inline: auto; padding-inline: 16px; }
.hero { display: flex; gap: 20px; align-items: center; padding-block: 32px 20px; border-block-end: 1px solid var(--border); }
.logo { flex: none; inline-size: 72px; block-size: 72px; color: var(--accent); }
.hero > div { min-inline-size: 0; }
.hero h1 { margin: 0; font-size: clamp(1.5rem, 4vw, 2.1rem); line-height: 1.2; }
.version { margin-inline-start: 8px; padding: 2px 8px; font-size: .8rem; font-weight: 600; color: var(--accent); background: var(--accent-soft); border-radius: 999px; vertical-align: middle; }
.tagline { margin: 6px 0 10px; color: var(--muted); }
.chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 0; padding: 0; list-style: none; }
.chips li { padding: 1px 10px; font-size: .78rem; color: var(--muted); border: 1px solid var(--border); border-radius: 999px; }
.layout { display: grid; gap: 24px; grid-template-columns: minmax(0, 1fr); padding-block: 8px 48px; }
@media (min-width: 900px) { .layout { grid-template-columns: minmax(0, 1fr) 280px; } }
.tabs { display: flex; gap: 4px; overflow-x: auto; border-block-end: 1px solid var(--border); position: sticky; inset-block-start: 0; background: var(--bg); z-index: 5; scrollbar-width: thin; }
.tabs button { flex: none; padding: 12px 14px; font: inherit; font-weight: 600; color: var(--muted); background: none; border: 0; border-block-end: 3px solid transparent; cursor: pointer; }
.tabs button:hover { color: var(--text); }
.tabs button[aria-selected="true"] { color: var(--text); border-block-end-color: var(--accent); }
.panel { padding-block: 8px 0; }
.panel[hidden] { display: none; }
.panel h2 { margin: 28px 0 8px; font-size: 1.4rem; }
.panel h3 { margin: 24px 0 8px; font-size: 1.1rem; }
.panel ul { padding-inline-start: 22px; }
code { padding: 1px 6px; font: .88em var(--mono); background: var(--code-bg); border-radius: 5px; }
.code { margin: 12px 0; border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
.code figcaption { display: flex; justify-content: space-between; align-items: center; padding: 4px 8px 4px 12px; font: .78rem var(--mono); color: var(--muted); background: var(--surface); border-block-end: 1px solid var(--border); }
.copy { padding: 3px 10px; font: .78rem var(--font); color: var(--text); background: var(--bg); border: 1px solid var(--border); border-radius: 6px; cursor: pointer; }
.copy:hover { border-color: var(--accent); }
.code pre { margin: 0; padding: 12px 14px; overflow-x: auto; background: var(--code-bg); }
.code pre code { padding: 0; background: none; font-size: .85rem; line-height: 1.5; }
.table-wrap { margin: 12px 0; overflow-x: auto; border: 1px solid var(--border); border-radius: var(--radius); }
table { inline-size: 100%; border-collapse: collapse; font-size: .92rem; }
th, td { padding: 8px 12px; text-align: start; vertical-align: top; border-block-end: 1px solid var(--border); }
th { background: var(--surface); white-space: nowrap; }
tr:last-child td { border-block-end: 0; }
.cards { display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); margin-block: 12px; }
.card { padding: 14px 16px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); }
.card h4 { margin: 0 0 4px; font-size: 1rem; }
.card p { margin: 0 0 8px; color: var(--muted); font-size: .92rem; }
.card .chips { margin-block-start: 6px; }
.callout { margin: 14px 0; padding: 4px 14px; border-inline-start: 4px solid var(--info); background: var(--surface); border-radius: 0 var(--radius) var(--radius) 0; }
.callout.tip { border-inline-start-color: var(--tip); }
.callout.warning { border-inline-start-color: var(--warning); }
.side { align-self: start; }
@media (min-width: 900px) { .side { position: sticky; inset-block-start: 60px; } }
.side section { margin-block-end: 20px; padding-block-start: 12px; }
.side h2 { margin: 0 0 8px; font-size: .95rem; }
.side dl { display: grid; grid-template-columns: auto 1fr; gap: 6px 14px; margin: 0; font-size: .9rem; }
.side dt { color: var(--muted); }
.side dd { margin: 0; overflow-wrap: anywhere; }
@media (max-width: 520px) { .hero { flex-direction: column; align-items: flex-start; } }
@media (prefers-reduced-motion: no-preference) { .tabs button { transition: color .15s, border-color .15s; } }
`;

/** Applied only when JavaScript is off: show every panel instead of an unusable tab bar. */
export const NOSCRIPT_STYLES = `.panel[hidden] { display: block; } .tabs, .copy { display: none; }`;
