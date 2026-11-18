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

/** An issue and the report line that accompanies it (some issues have no report). */
interface Finding {
  issue: HtmlIssue;
  report?: string;
}

/** Whole-document checks: each one fires when `missing` holds for the full HTML text. */
const DOCUMENT_RULES: ReadonlyArray<{ missing: (html: string) => boolean } & Finding> = [
  {
    missing: (html) => !html.toUpperCase().includes("<!DOCTYPE"),
    issue: {
      type: "missing_doctype",
      severity: "critical",
      message: "Missing DOCTYPE declaration",
      suggestion: "Add '<!DOCTYPE html>' at the beginning of the file",
    },
    report: "🔴 Missing DOCTYPE declaration",
  },
  {
    missing: (html) => !html.includes("charset"),
    issue: {
      type: "missing_charset",
      severity: "high",
      message: "Missing character encoding specification",
      suggestion: 'Add <meta charset="UTF-8"> in the <head> section',
    },
    report: "❌ Missing charset meta tag",
  },
  {
    missing: (html) => !html.includes("viewport"),
    issue: {
      type: "missing_viewport",
      severity: "high",
      message: "Missing viewport meta tag for responsive design",
      suggestion: 'Add <meta name="viewport" content="width=device-width, initial-scale=1">',
    },
    report: "⚠️ Missing viewport meta tag",
  },
  {
    missing: (html) => !html.includes("<title>") || !html.includes("</title>"),
    issue: {
      type: "missing_title",
      severity: "high",
      message: "Missing page title",
      suggestion: "Add <title>Page Title</title> in the <head> section",
    },
    report: "❌ Missing <title> tag",
  },
  {
    missing: (html) => !html.includes('lang="') && !html.includes("lang='"),
    issue: {
      type: "missing_lang",
      severity: "medium",
      message: "Missing language attribute on html element",
      suggestion: 'Add lang attribute: <html lang="en">',
    },
    report: "ℹ️ Missing lang attribute on <html>",
  },
];

/** Element counters: a line adds one to `key` when `matches` holds. */
const ELEMENT_COUNTERS: ReadonlyArray<{
  key: keyof Omit<HtmlScanResult["statistics"], "totalElements">;
  matches: (line: string) => boolean;
}> = [
  { key: "images", matches: (line) => line.includes("<img") },
  { key: "links", matches: (line) => line.includes("<a ") || line.includes("<a>") },
  { key: "scripts", matches: (line) => line.includes("<script") },
  { key: "stylesheets", matches: (line) => line.includes("<link") && line.includes("stylesheet") },
];

/** Adds one line's element counts to `statistics`. */
function countElements(line: string, statistics: HtmlScanResult["statistics"]): void {
  statistics.totalElements += line.match(/<(\w+)[>\s]/g)?.length ?? 0;
  for (const { key, matches } of ELEMENT_COUNTERS) {
    if (matches(line)) statistics[key]++;
  }
}

function deprecatedTagFindings(line: string, lineNo: number): Finding[] {
  return deprecatedTags
    .filter((tag) => line.includes(`<${tag}`))
    .map((tag) => ({
      issue: {
        type: "deprecated_tags",
        element: tag,
        line: lineNo,
        severity: "medium",
        message: `Deprecated HTML tag used: <${tag}>`,
        suggestion: `Replace <${tag}> with appropriate semantic HTML5 elements or CSS`,
      },
      report: `⚠️ Deprecated tag <${tag}> found at line ${lineNo}`,
    }));
}

function missingAltFindings(line: string, lineNo: number): Finding[] {
  if (!line.includes("<img") || line.includes("alt=")) return [];
  const src = line.match(/src=["']([^"']+)["']/)?.[1];
  return [
    {
      issue: {
        type: "missing_alt_text",
        element: "img",
        line: lineNo,
        severity: "high",
        message: "Image missing alt text (accessibility issue)",
        suggestion: `Add descriptive alt text: <img src="${src || ""}" alt="description">`,
      },
      report: `🔴 Image missing alt text at line ${lineNo}: ${src}`,
    },
  ];
}

function emptyStyleFindings(line: string, lineNo: number): Finding[] {
  if (!line.includes('style=""') && !line.includes("style=''")) return [];
  return [
    {
      issue: {
        type: "unused_attributes",
        line: lineNo,
        severity: "low",
        message: "Empty style attribute found",
        suggestion: "Remove empty style attributes",
      },
    },
  ];
}

/**
 * Scan html.
 *
 * @param htmlContent - Html content
 * @returns Scan html result
 */
export function scanHtml(htmlContent: string): HtmlScanResult {
  const issues: HtmlIssue[] = [];
  const reports: string[] = [];
  const statistics = { totalElements: 0, images: 0, links: 0, scripts: 0, stylesheets: 0 };

  const record = (finding: Finding): void => {
    issues.push(finding.issue);
    if (finding.report !== undefined) reports.push(finding.report);
  };

  DOCUMENT_RULES.filter((rule) => rule.missing(htmlContent)).forEach(record);

  htmlContent.split("\n").forEach((raw, index) => {
    const line = raw.trim();
    const lineNo = index + 1;
    countElements(line, statistics);
    [
      ...deprecatedTagFindings(line, lineNo),
      ...missingAltFindings(line, lineNo),
      ...emptyStyleFindings(line, lineNo),
    ].forEach(record);
  });

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
