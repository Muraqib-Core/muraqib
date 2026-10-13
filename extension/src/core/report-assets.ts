/**
 * Static CSS and JS for the report webview. Both are constants (no interpolated data) so the
 * CSP can allow them by nonce alone. Uses CSS logical properties so the layout mirrors in RTL.
 */
export const REPORT_STYLES = `
:root { color-scheme: light dark; }
body { font-family: var(--vscode-font-family, system-ui, sans-serif); font-size: var(--vscode-font-size, 13px);
  color: var(--vscode-foreground); background: var(--vscode-editor-background); margin: 0; padding: 16px; line-height: 1.5; }
main { max-inline-size: 960px; margin-inline: auto; }
h1 { font-size: 1.5em; margin-block: 0 .5em; }
h2 { font-size: 1.15em; margin-block: 1.5em .5em; border-block-end: 1px solid var(--vscode-panel-border, #8884); padding-block-end: .25em; }
.project { margin: .25em 0; color: var(--vscode-descriptionForeground); }
.verdict { display: inline-block; font-weight: 700; padding: 2px 10px; border-radius: 4px; margin: .25em 0; }
.verdict.pass { background: var(--vscode-testing-iconPassed, #2e7d32); color: #fff; }
.verdict.fail { background: var(--vscode-errorForeground, #c62828); color: #fff; }
.chips, .tags, .inputs, .diag, .issues { list-style: none; margin: 0; padding: 0; }
.chips { display: flex; flex-wrap: wrap; gap: 8px; margin-block: .5em; }
.chip { border: 1px solid var(--vscode-panel-border, #8886); border-radius: 4px; padding: 2px 8px; }
.toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-block: 1em; }
button { font: inherit; cursor: pointer; color: var(--vscode-button-secondaryForeground, inherit);
  background: var(--vscode-button-secondaryBackground, #8883); border: 1px solid transparent; border-radius: 3px; padding: 4px 12px; }
button.primary { color: var(--vscode-button-foreground, #fff); background: var(--vscode-button-background, #0e639c); }
button:disabled { opacity: .5; cursor: default; }
button:focus-visible { outline: 1px solid var(--vscode-focusBorder, #07f); outline-offset: 2px; }
.busy-note { display: none; color: var(--vscode-descriptionForeground); }
body.busy .busy-note { display: inline; }
.banner { border-inline-start: 4px solid var(--vscode-errorForeground, #c62828); background: var(--vscode-inputValidation-errorBackground, #c628281a);
  padding: 8px 12px; margin-block: 1em; }
.note, .empty { color: var(--vscode-descriptionForeground); }
.group { margin-block: .5em; }
.group > summary { cursor: pointer; padding-block: 4px; }
.issues { display: grid; gap: 8px; margin-block: .5em; }
.issue { border: 1px solid var(--vscode-panel-border, #8886); border-inline-start-width: 4px; border-radius: 4px; padding: 8px 12px; }
.issue.sev-critical { border-inline-start-color: #b71c1c; }
.issue.sev-error { border-inline-start-color: #e53935; }
.issue.sev-warning { border-inline-start-color: #f9a825; }
.issue.sev-info { border-inline-start-color: #1e88e5; }
.issue-head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.badge { font-size: .85em; font-weight: 600; padding: 1px 8px; border-radius: 10px; border: 1px solid currentColor; }
.badge.sev-critical { color: #ef5350; } .badge.sev-error { color: #ff7043; }
.badge.sev-warning { color: #f9a825; } .badge.sev-info { color: #42a5f5; }
code, .module { font-family: var(--vscode-editor-font-family, monospace); color: var(--vscode-descriptionForeground); }
.loc { font-family: var(--vscode-editor-font-family, monospace); padding: 0 6px; background: none;
  color: var(--vscode-textLink-foreground, #3794ff); text-decoration: underline; border: none; }
.msg, .rec { margin: .4em 0 0; overflow-wrap: anywhere; }
.tags { display: flex; flex-wrap: wrap; gap: 6px; margin-block-start: .4em; }
.tags li { font-size: .8em; padding: 0 6px; border-radius: 3px; background: var(--vscode-badge-background, #8883); color: var(--vscode-badge-foreground, inherit); }
.status { font-size: .85em; opacity: .8; }
.table-wrap { overflow-x: auto; margin-block: .5em; }
table { border-collapse: collapse; inline-size: 100%; }
caption { text-align: start; font-weight: 600; padding-block: 4px; }
th, td { text-align: start; padding: 4px 8px; border: 1px solid var(--vscode-panel-border, #8886); vertical-align: top; overflow-wrap: anywhere; }
@media (forced-colors: active) { .issue, .chip, .badge { border-color: CanvasText; } }
`;

/**
 * Event delegation only: reads `data-*` attributes of clicked controls and posts typed messages.
 * It never builds HTML, never evaluates strings and carries no report data of its own.
 */
export const REPORT_SCRIPT = `
(function () {
  var api = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : undefined;
  if (!api) return;
  function positive(value) {
    var n = Number(value);
    return value !== null && isFinite(n) && n >= 1 && Math.floor(n) === n ? n : undefined;
  }
  document.addEventListener('click', function (event) {
    var target = event.target;
    var el = target && target.closest ? target.closest('[data-action]') : null;
    if (!el || el.disabled) return;
    var action = el.getAttribute('data-action');
    if (action === 'run') api.postMessage({ type: 'runAudit' });
    else if (action === 'docs') api.postMessage({ type: 'showDocs' });
    else if (action === 'open') {
      var message = { type: 'openFile', file: el.getAttribute('data-file') || '' };
      var line = positive(el.getAttribute('data-line'));
      var column = positive(el.getAttribute('data-column'));
      if (line !== undefined) message.line = line;
      if (column !== undefined) message.column = column;
      api.postMessage(message);
    }
  });
  window.addEventListener('message', function (event) {
    var data = event.data;
    if (data && data.type === 'busy') {
      document.body.classList.toggle('busy', data.busy === true);
      var run = document.querySelector('[data-action="run"]');
      if (run) run.disabled = data.busy === true;
    }
  });
  api.postMessage({ type: 'ready' });
})();
`;
