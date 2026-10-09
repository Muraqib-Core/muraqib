/**
 * HTML Scanner - Comprehensive HTML quality and performance analysis
 */

export interface HtmlIssue {
  type:
    | "missing_doctype"
    | "missing_charset"
    | "missing_viewport"
    | "missing_title"
    | "invalid_nesting"
    | "missing_alt_text"
    | "deprecated_tags"
    | "unused_attributes"
    | "missing_lang"
    | "accessibility_issue";
  element?: string;
  line?: number;
  severity: "critical" | "high" | "medium" | "low";
  message: string;
  suggestion: string;
}

export interface HtmlScanResult {
  isValid: boolean;
  reports: string[];
  issues: HtmlIssue[];
  statistics: {
    totalElements: number;
    images: number;
    links: number;
    scripts: number;
    stylesheets: number;
  };
}

const deprecatedTags = [
  "font",
  "center",
  "big",
  "small",
  "frame",
  "frameset",
  "noframe",
];

export function scanHtml(htmlContent: string): HtmlScanResult {
  const issues: HtmlIssue[] = [];
  const reports: string[] = [];
  const lines = htmlContent.split("\n");

  const statistics = {
    totalElements: 0,
    images: 0,
    links: 0,
    scripts: 0,
    stylesheets: 0,
  };

  // Check doctype
  if (!htmlContent.toUpperCase().includes("<!DOCTYPE")) {
    issues.push({
      type: "missing_doctype",
      severity: "critical",
      message: "Missing DOCTYPE declaration",
      suggestion: "Add '<!DOCTYPE html>' at the beginning of the file",
    });
    reports.push("🔴 Missing DOCTYPE declaration");
  }

  // Check charset in head
  if (!htmlContent.includes("charset")) {
    issues.push({
      type: "missing_charset",
      severity: "high",
      message: "Missing character encoding specification",
      suggestion:
        'Add <meta charset="UTF-8"> in the <head> section',
    });
    reports.push("❌ Missing charset meta tag");
  }

  // Check viewport meta tag
  if (!htmlContent.includes("viewport")) {
    issues.push({
      type: "missing_viewport",
      severity: "high",
      message: "Missing viewport meta tag for responsive design",
      suggestion:
        'Add <meta name="viewport" content="width=device-width, initial-scale=1">',
    });
    reports.push("⚠️ Missing viewport meta tag");
  }

  // Check title tag
  if (!htmlContent.includes("<title>") || !htmlContent.includes("</title>")) {
    issues.push({
      type: "missing_title",
      severity: "high",
      message: "Missing page title",
      suggestion: "Add <title>Page Title</title> in the <head> section",
    });
    reports.push("❌ Missing <title> tag");
  }

  // Check lang attribute on html tag
  if (!htmlContent.includes('lang="') && !htmlContent.includes("lang='")) {
    issues.push({
      type: "missing_lang",
      severity: "medium",
      message: "Missing language attribute on html element",
      suggestion: 'Add lang attribute: <html lang="en">',
    });
    reports.push("ℹ️ Missing lang attribute on <html>");
  }

  // Scan for issues line by line
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]?.trim() || "";

    // Count elements
    const tagMatches = line.match(/<(\w+)[>\s]/g);
    if (tagMatches) {
      statistics.totalElements += tagMatches.length;
    }

    // Count specific elements
    if (line.includes("<img")) statistics.images++;
    if (line.includes("<a ") || line.includes("<a>")) statistics.links++;
    if (line.includes("<script")) statistics.scripts++;
    if (line.includes("<link") && line.includes("stylesheet"))
      statistics.stylesheets++;

    // Check for deprecated tags
    for (const tag of deprecatedTags) {
      if (line.includes(`<${tag}`)) {
        issues.push({
          type: "deprecated_tags",
          element: tag,
          line: i + 1,
          severity: "medium",
          message: `Deprecated HTML tag used: <${tag}>`,
          suggestion: `Replace <${tag}> with appropriate semantic HTML5 elements or CSS`,
        });
        reports.push(`⚠️ Deprecated tag <${tag}> found at line ${i + 1}`);
      }
    }

    // Check for missing alt text on images
    if (line.includes("<img") && !line.includes("alt=")) {
      const srcMatch = line.match(/src=["']([^"']+)["']/);
      issues.push({
        type: "missing_alt_text",
        element: "img",
        line: i + 1,
        severity: "high",
        message: "Image missing alt text (accessibility issue)",
        suggestion: `Add descriptive alt text: <img src="${srcMatch?.[1] || ''}" alt="description">`,
      });
      reports.push(
        `🔴 Image missing alt text at line ${i + 1}: ${srcMatch?.[1]}`
      );
    }

    // Check for unused style attributes
    if (line.includes('style=""') || line.includes("style=''")) {
      issues.push({
        type: "unused_attributes",
        line: i + 1,
        severity: "low",
        message: "Empty style attribute found",
        suggestion: "Remove empty style attributes",
      });
    }
  }

  const isValid =
    issues.filter((i) => i.severity === "critical" || i.severity === "high")
      .length === 0;

  if (isValid && reports.length === 0) {
    reports.push("✅ HTML structure looks valid and well-formed");
  }

  return {
    isValid,
    reports,
    issues,
    statistics,
  };
}
