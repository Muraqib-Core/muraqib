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

export function performRenderBlockingAudit(
  htmlContent: string
): RenderBlockingAuditResult {
  const reports: string[] = [];
  const criticalIssues: RenderBlockingIssue[] = [];
  const blockingResources: string[] = [];

  const lines = htmlContent.split("\n");
  let headSection = false;
  let bodySection = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]?.trim() || "";

    if (line.includes("<head")) {
      headSection = true;
      bodySection = false;
      continue;
    }

    if (line.includes("</head>")) {
      headSection = false;
      continue;
    }

    if (line.includes("<body")) {
      bodySection = true;
      headSection = false;
      continue;
    }

    // Detect render-blocking CSS in head
    if (headSection && line.includes("<link") && line.includes("stylesheet")) {
      if (!line.includes("media=")) {
        const hrefMatch = line.match(/href=["']([^"']+)["']/);
        const href = hrefMatch?.[1];
        if (href) {
          criticalIssues.push({
            type: "render_blocking_css",
            resource: href,
            line: i + 1,
            severity: "high",
            suggestion: `Defer non-critical CSS or use media queries to prevent render blocking: ${href}`,
          });
          blockingResources.push(href);
          reports.push(`⚠️ Render-blocking CSS in <head>: ${href}`);
        }
      }
    }

    // Detect synchronous scripts in head
    if (headSection && line.includes("<script")) {
      if (!line.includes("defer") && !line.includes("async")) {
        const src = line.match(/src=["']([^"']+)["']/)?.[1] || "inline";
        criticalIssues.push({
          type: "render_blocking_js",
          resource: src,
          line: i + 1,
          severity: "critical",
          suggestion: `Add 'defer' or 'async' attribute to non-critical scripts: <script src="${src}" defer></script>`,
        });
        blockingResources.push(src);
        reports.push(`🔴 CRITICAL: Synchronous script in <head>: ${src}`);
      }
    }

    // Detect font files without preload
    if (line.includes("@font-face") || line.includes("google.*fonts")) {
      const fontMatch = line.match(/url\(["']([^"']+\.(?:woff2|woff|ttf))["']\)/);
      if (fontMatch && fontMatch[1] && !htmlContent.includes(`preload`)) {
        const fontFile = fontMatch[1];
        criticalIssues.push({
          type: "large_font_files",
          resource: fontFile,
          severity: "medium",
          suggestion: `Preload critical fonts: <link rel="preload" href="${fontFile}" as="font" type="font/woff2">`,
        });
        reports.push(`ℹ️ Font file could benefit from preload: ${fontFile}`);
      }
    }
  }

  // Analyze body section for scripts
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]?.trim() || "";

    if (bodySection && line.includes("<script") && !line.includes("async")) {
      if (line.includes("src=")) {
        const src = line.match(/src=["']([^"']+)["']/)?.[1];
        if (src && !blockingResources.includes(src)) {
          reports.push(`ℹ️ Script in body (OK): ${src}`);
        }
      }
    }

    if (line.includes("</body>")) {
      bodySection = false;
    }
  }

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
