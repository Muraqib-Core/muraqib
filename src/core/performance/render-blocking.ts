/**
 * Render-Blocking Resource Detector
 * Identifies resources that block initial page rendering (CSS, JS in head)
 */

export interface RenderBlockingIssue {
  type:
    | "render_blocking_css"
    | "render_blocking_js"
    | "unused_css"
    | "synchronous_script"
    | "large_font_files";
  resource: string;
  line?: number;
  size?: number;
  severity: "critical" | "high" | "medium";
  suggestion: string;
}

export interface RenderBlockingAuditResult {
  isOptimized: boolean;
  reports: string[];
  criticalIssues: RenderBlockingIssue[];
  blockingResources: string[];
}

/** What one line of HTML contributed: an issue, its report line and, if blocking, the resource. */
interface Detection {
  issue: RenderBlockingIssue;
  report: string;
  blocking?: string;
}

interface SectionState {
  head: boolean;
  body: boolean;
}

/**
 * Updates the head/body state for a structural line (`<head`, `</head>`, `<body`).
 * @returns True when the line was structural and must not be inspected for resources.
 */
function enterSection(line: string, state: SectionState): boolean {
  if (line.includes("<head")) {
    state.head = true;
    state.body = false;
    return true;
  }
  if (line.includes("</head>")) {
    state.head = false;
    return true;
  }
  if (line.includes("<body")) {
    state.body = true;
    state.head = false;
    return true;
  }
  return false;
}

/** Value of an HTML attribute (`""` when present without a value), or undefined when the tag lacks it. */
function attribute(tag: string, name: string): string | undefined {
  const match = new RegExp(`\\s${name}(?:\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+)))?(?=[\\s/>])`, "i").exec(tag);
  return match ? (match[1] ?? match[2] ?? match[3] ?? "") : undefined;
}

const JS_SCRIPT_TYPES = new Set(["", "text/javascript", "application/javascript", "application/x-javascript"]);

/** A stylesheet `<link>` without a `media` attribute blocks rendering. */
function detectBlockingCss(tag: string, lineNo: number): Detection | undefined {
  const rel = (attribute(tag, "rel") ?? "").toLowerCase().split(/\s+/);
  if (!rel.includes("stylesheet") || rel.includes("alternate") || attribute(tag, "media") !== undefined) return undefined;
  const href = attribute(tag, "href");
  if (!href) return undefined;
  return {
    issue: {
      type: "render_blocking_css",
      resource: href,
      line: lineNo,
      severity: "high",
      suggestion: `Defer non-critical CSS or use media queries to prevent render blocking: ${href}`,
    },
    report: `⚠️ Render-blocking CSS in <head>: ${href}`,
    blocking: href,
  };
}

/**
 * A classic `<script>` without `defer` or `async` blocks rendering. Module scripts are deferred by
 * default and non-JavaScript types (JSON-LD, importmap, templates) are never executed.
 */
function detectSyncScript(tag: string, lineNo: number): Detection | undefined {
  const type = (attribute(tag, "type") ?? "").trim().toLowerCase();
  if (!JS_SCRIPT_TYPES.has(type)) return undefined;
  if (attribute(tag, "defer") !== undefined || attribute(tag, "async") !== undefined) return undefined;
  const src = attribute(tag, "src") || "inline";
  return {
    issue: {
      type: "render_blocking_js",
      resource: src,
      line: lineNo,
      severity: "critical",
      suggestion: `Add 'defer' or 'async' attribute to non-critical scripts: <script src="${src}" defer></script>`,
    },
    report: `🔴 CRITICAL: Synchronous script in <head>: ${src}`,
    blocking: src,
  };
}

/** Finds the blocking stylesheets and scripts inside `<head>`, whatever the document's line layout. */
function detectHeadResources(htmlContent: string): Detection[] {
  const head = /<head\b[^>]*>([\s\S]*?)<\/head\s*>/i.exec(htmlContent);
  if (!head) return [];
  const headStart = head.index + head[0].indexOf(head[1] ?? "");
  const detections: Detection[] = [];
  for (const tagMatch of (head[1] ?? "").matchAll(/<(script|link)\b[^>]*>/gi)) {
    const lineNo = htmlContent.slice(0, headStart + tagMatch.index).split("\n").length;
    const found = tagMatch[1]?.toLowerCase() === "link"
      ? detectBlockingCss(tagMatch[0], lineNo)
      : detectSyncScript(tagMatch[0], lineNo);
    if (found) detections.push(found);
  }
  return detections;
}

/** A font file referenced from CSS in a document that never mentions `preload`. */
function detectUnpreloadedFont(line: string, htmlContent: string): Detection | undefined {
  if (!line.includes("@font-face") && !line.includes("google.*fonts")) return undefined;
  const fontFile = line.match(/url\(["']([^"']+\.(?:woff2|woff|ttf))["']\)/)?.[1];
  if (!fontFile || htmlContent.includes("preload")) return undefined;
  return {
    issue: {
      type: "large_font_files",
      resource: fontFile,
      severity: "medium",
      suggestion: `Preload critical fonts: <link rel="preload" href="${fontFile}" as="font" type="font/woff2">`,
    },
    report: `ℹ️ Font file could benefit from preload: ${fontFile}`,
  };
}

/** Informational reports for external body scripts that were not already flagged as blocking. */
function bodyScriptReports(lines: readonly string[], blockingResources: readonly string[], inBody: boolean): string[] {
  const reports: string[] = [];
  let insideBody = inBody;
  for (const raw of lines) {
    const line = raw.trim();
    if (insideBody && line.includes("<script") && !line.includes("async") && line.includes("src=")) {
      const src = line.match(/src=["']([^"']+)["']/)?.[1];
      if (src && !blockingResources.includes(src)) reports.push(`ℹ️ Script in body (OK): ${src}`);
    }
    if (line.includes("</body>")) insideBody = false;
  }
  return reports;
}

/**
 * Perform render blocking audit.
 *
 * @param htmlContent - Html content
 * @returns Perform render blocking audit result
 */
export function performRenderBlockingAudit(
  htmlContent: string
): RenderBlockingAuditResult {
  const reports: string[] = [];
  const criticalIssues: RenderBlockingIssue[] = [];
  const blockingResources: string[] = [];

  const lines = htmlContent.split("\n");
  const state: SectionState = { head: false, body: false };

  const detections: Array<Detection | undefined> = detectHeadResources(htmlContent);
  lines.forEach((raw) => {
    const line = raw.trim();
    if (enterSection(line, state)) return;
    detections.push(detectUnpreloadedFont(line, htmlContent));
  });
  for (const found of detections) {
    if (found === undefined) continue;
    criticalIssues.push(found.issue);
    reports.push(found.report);
    if (found.blocking !== undefined) blockingResources.push(found.blocking);
  }

  // Analyze body section for scripts
  reports.push(...bodyScriptReports(lines, blockingResources, state.body));

  const isOptimized = criticalIssues.filter((i) => i.severity === "critical")
    .length === 0;

  if (isOptimized && reports.length === 0) {
    reports.push("✅ No render-blocking resources detected");
  }

  return {
    isOptimized,
    reports,
    criticalIssues,
    blockingResources,
  };
}
