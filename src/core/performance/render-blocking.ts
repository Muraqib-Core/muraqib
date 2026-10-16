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

/** A stylesheet `<link>` without a `media` attribute blocks rendering. */
function detectBlockingCss(line: string, lineNo: number): Detection | undefined {
  if (!line.includes("<link") || !line.includes("stylesheet") || line.includes("media=")) return undefined;
  const href = line.match(/href=["']([^"']+)["']/)?.[1];
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

/** A `<script>` without `defer` or `async` blocks rendering. */
function detectSyncScript(line: string, lineNo: number): Detection | undefined {
  if (!line.includes("<script") || line.includes("defer") || line.includes("async")) return undefined;
  const src = line.match(/src=["']([^"']+)["']/)?.[1] || "inline";
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

  lines.forEach((raw, index) => {
    const line = raw.trim();
    if (enterSection(line, state)) return;

    const lineNo = index + 1;
    const detections = [
      state.head ? detectBlockingCss(line, lineNo) : undefined,
      state.head ? detectSyncScript(line, lineNo) : undefined,
      detectUnpreloadedFont(line, htmlContent),
    ];
    for (const found of detections) {
      if (found === undefined) continue;
      criticalIssues.push(found.issue);
      reports.push(found.report);
      if (found.blocking !== undefined) blockingResources.push(found.blocking);
    }
  });

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
