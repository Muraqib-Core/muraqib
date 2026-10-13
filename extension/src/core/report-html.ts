import type { AgentIssue, AgentModuleSummary, AgentReport, AgentSeverity } from "./types.js";
import { escapeHtml, isValidNonce } from "./escape.js";
import { getLabels, type Labels } from "./labels.js";
import { REPORT_SCRIPT, REPORT_STYLES } from "./report-assets.js";

/** Display order of severities, most serious first. */
export const SEVERITY_ORDER: readonly AgentSeverity[] = ["critical", "error", "warning", "info"];

/** Options for the HTML renderers. */
export interface RenderReportOptions {
  /** CSP nonce shared by the policy, the inline style and the inline script. */
  nonce: string;
  /** VS Code language tag (`vscode.env.language`); selects labels and text direction. */
  language?: string | undefined;
  /** True while an audit is running; shows the busy state and disables the run button. */
  busy?: boolean | undefined;
}

/** Strict policy: no network, no remote resources, only this document's nonce-tagged style and script. */
function csp(nonce: string): string {
  return `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; img-src data:; base-uri 'none'; form-action 'none'`;
}

function requireNonce(nonce: string): void {
  if (!isValidNonce(nonce)) throw new Error("Invalid CSP nonce: expected at least 8 base64/base64url characters");
}

function isSeverity(value: unknown): value is AgentSeverity {
  return value === "critical" || value === "error" || value === "warning" || value === "info";
}

/** Coerce a possibly malformed engine value into a display string; always escaped by callers. */
function str(value: unknown): string {
  return typeof value === "string" ? value : value === undefined || value === null ? "" : String(value);
}

function positiveInt(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 ? value : undefined;
}

function documentShell(body: string, options: RenderReportOptions, labels: Labels): string {
  const { nonce } = options;
  return (
    `<!DOCTYPE html><html lang="${escapeHtml(labels.lang)}" dir="${labels.dir}"><head>` +
    `<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<meta http-equiv="Content-Security-Policy" content="${csp(nonce)}">` +
    `<title>${escapeHtml(labels.title)}</title>` +
    `<style nonce="${nonce}">${REPORT_STYLES}</style></head>` +
    `<body${options.busy === true ? ' class="busy"' : ""}>${body}` +
    `<script nonce="${nonce}">${REPORT_SCRIPT}</script></body></html>`
  );
}

function renderToolbar(labels: Labels, busy: boolean): string {
  return (
    `<div class="toolbar">` +
    `<button type="button" class="primary" data-action="run"${busy ? " disabled" : ""}>${escapeHtml(labels.runAudit)}</button>` +
    `<button type="button" data-action="docs">${escapeHtml(labels.showDocs)}</button>` +
    `<span class="busy-note" role="status">${escapeHtml(labels.running)}</span></div>`
  );
}

function renderLocation(issue: AgentIssue, labels: Labels): string {
  const file = str(issue.file);
  if (file === "") return "";
  const line = positiveInt(issue.line);
  const column = positiveInt(issue.column);
  const shown = `${file}${line !== undefined ? `:${line}` : ""}${column !== undefined ? `:${column}` : ""}`;
  return (
    `<button type="button" class="loc" data-action="open" data-file="${escapeHtml(file)}"` +
    `${line !== undefined ? ` data-line="${line}"` : ""}${column !== undefined ? ` data-column="${column}"` : ""}` +
    ` title="${escapeHtml(labels.openFile)}"><bdi dir="ltr">${escapeHtml(shown)}</bdi></button>`
  );
}

function renderIssue(issue: AgentIssue, labels: Labels): string {
  const severity: AgentSeverity = isSeverity(issue.severity) ? issue.severity : "info";
  const tags = (Array.isArray(issue.tags) ? issue.tags : []).map((tag) => `<li>${escapeHtml(str(tag))}</li>`).join("");
  const recommendation =
    issue.recommendation !== undefined && str(issue.recommendation) !== ""
      ? `<p class="rec"><strong>${escapeHtml(labels.recommendation)}:</strong> <span dir="auto">${escapeHtml(str(issue.recommendation))}</span></p>`
      : "";
  return (
    `<li class="issue sev-${severity}"><div class="issue-head">` +
    `<span class="badge sev-${severity}">${escapeHtml(labels.severity[severity])}</span>` +
    `<strong dir="auto">${escapeHtml(str(issue.title))}</strong>` +
    `<code dir="ltr">${escapeHtml(str(issue.code))}</code>` +
    `<span class="module" dir="ltr">${escapeHtml(str(issue.module))}</span>${renderLocation(issue, labels)}</div>` +
    `<p class="msg" dir="auto">${escapeHtml(str(issue.message))}</p>${recommendation}` +
    `${tags === "" ? "" : `<ul class="tags">${tags}</ul>`}</li>`
  );
}

function renderBySeverity(issues: readonly AgentIssue[], labels: Labels): string {
  const sections = SEVERITY_ORDER.map((severity) => {
    const group = issues.filter((issue) => issue.severity === severity);
    if (group.length === 0) return "";
    return (
      `<details class="group sev-${severity}" open><summary><span class="badge sev-${severity}">${escapeHtml(labels.severity[severity])}</span>` +
      ` <span class="count">${group.length}</span></summary><ul class="issues">${group.map((i) => renderIssue(i, labels)).join("")}</ul></details>`
    );
  }).join("");
  return `<section aria-labelledby="h-sev"><h2 id="h-sev">${escapeHtml(labels.bySeverity)}</h2>${
    sections === "" ? `<p class="empty">${escapeHtml(labels.noIssues)}</p>` : sections
  }</section>`;
}

function renderCoverage(module: AgentModuleSummary, labels: Labels): string {
  const coverage = module.scan?.scannerCoverage;
  if (!Array.isArray(coverage) || coverage.length === 0) return "";
  const rows = coverage
    .map((entry) => {
      const scanned = Array.isArray(entry.scannedInputs) ? entry.scannedInputs : [];
      const skipped = Array.isArray(entry.skippedInputs) ? entry.skippedInputs : [];
      const diagnostics = Array.isArray(entry.diagnostics) ? entry.diagnostics : [];
      const list = (items: readonly unknown[]): string =>
        items.length === 0
          ? ""
          : `<details><summary>${items.length}</summary><ul class="inputs">${items
              .map((item) => `<li dir="ltr">${escapeHtml(str(item))}</li>`)
              .join("")}</ul></details>`;
      const diag =
        diagnostics.length === 0
          ? "-"
          : `<ul class="diag">${diagnostics.map((d) => `<li dir="auto">${escapeHtml(str(d))}</li>`).join("")}</ul>`;
      return (
        `<tr><th scope="row" dir="ltr">${escapeHtml(str(entry.scanner))}</th><td>${escapeHtml(str(entry.status))}</td>` +
        `<td>${scanned.length === 0 ? "0" : list(scanned)}</td><td>${skipped.length === 0 ? "0" : list(skipped)}</td><td>${diag}</td></tr>`
      );
    })
    .join("");
  return (
    `<div class="table-wrap"><table class="coverage"><caption>${escapeHtml(labels.coverage)}</caption><thead><tr>` +
    `<th scope="col">${escapeHtml(labels.scanner)}</th><th scope="col">${escapeHtml(labels.status)}</th>` +
    `<th scope="col">${escapeHtml(labels.scanned)}</th><th scope="col">${escapeHtml(labels.skipped)}</th>` +
    `<th scope="col">${escapeHtml(labels.diagnostics)}</th></tr></thead><tbody>${rows}</tbody></table></div>`
  );
}

function renderByModule(report: AgentReport, labels: Labels): string {
  const sections = report.modules
    .map((module) => {
      const issues = report.issues.filter((issue) => issue.module === module.name);
      return (
        `<details class="group module" open><summary><strong dir="ltr">${escapeHtml(str(module.name))}</strong> ` +
        `<span class="status st-${escapeHtml(str(module.status).replace(/[^a-z]/g, ""))}">${escapeHtml(str(module.status))}</span> ` +
        `<span class="count">${escapeHtml(str(module.issueCount))} ${escapeHtml(labels.issues)}</span></summary>` +
        `${renderCoverage(module, labels)}` +
        `${issues.length === 0 ? "" : `<ul class="issues">${issues.map((i) => renderIssue(i, labels)).join("")}</ul>`}</details>`
      );
    })
    .join("");
  return `<section aria-labelledby="h-mod"><h2 id="h-mod">${escapeHtml(labels.byModule)}</h2>${sections}</section>`;
}

/**
 * Render a complete audit report document. Every dynamic value (messages, titles, paths,
 * module names, scanner diagnostics) is escaped; the only script is a constant that reads
 * `data-*` attributes and posts typed messages to the host.
 *
 * @throws Error when the nonce is malformed.
 */
export function renderReportHtml(report: AgentReport, options: RenderReportOptions): string {
  requireNonce(options.nonce);
  const labels = getLabels(options.language);
  const summary = report.summary;
  const failed = report.ok !== true;
  const verdict = report.verdict === "pass" ? labels.verdictPass : labels.verdictFail;
  const chips = SEVERITY_ORDER.map(
    (severity) =>
      `<li class="chip sev-${severity}"><span>${escapeHtml(labels.severity[severity])}</span> <strong>${escapeHtml(str(summary[severity]))}</strong></li>`
  ).join("");
  const banner = failed
    ? `<div class="banner" role="alert"><strong>${escapeHtml(labels.auditFailed)}</strong>${
        report.error !== undefined ? `<p dir="auto">${escapeHtml(str(report.error))}</p>` : ""
      }</div>`
    : "";
  const truncated =
    report.truncated > 0 ? `<p class="note">${escapeHtml(str(report.truncated))} ${escapeHtml(labels.truncated)}</p>` : "";
  const body =
    `<main><header><h1>${escapeHtml(labels.title)}</h1>` +
    `<p class="project"><span>${escapeHtml(labels.project)}:</span> <bdi dir="ltr">${escapeHtml(str(report.projectRoot))}</bdi></p>` +
    `<p class="verdict ${report.verdict === "pass" ? "pass" : "fail"}">${escapeHtml(verdict)}</p>` +
    `<ul class="chips">${chips}</ul></header>${renderToolbar(labels, options.busy === true)}` +
    `${banner}${truncated}${renderBySeverity(report.issues, labels)}${renderByModule(report, labels)}</main>`;
  return documentShell(body, options, labels);
}

/** Render the empty / running placeholder shown before the first report exists. */
export function renderPlaceholderHtml(options: RenderReportOptions): string {
  requireNonce(options.nonce);
  const labels = getLabels(options.language);
  const busy = options.busy === true;
  const body =
    `<main><header><h1>${escapeHtml(labels.title)}</h1></header>${renderToolbar(labels, busy)}` +
    `<p class="empty">${escapeHtml(busy ? labels.running : labels.noReport)}</p>` +
    `${busy ? "" : `<p class="note">${escapeHtml(labels.noReportHint)}</p>`}</main>`;
  return documentShell(body, options, labels);
}
