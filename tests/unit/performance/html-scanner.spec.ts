import { describe, expect, test } from "vitest";
import { scanHtml } from "../../../src/core/performance/html-scanner.js";

const VALID = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Page</title>
</head>
<body><img src="a.png" alt="a"><a href="/">x</a></body>
</html>`;

describe("scanHtml", () => {
  test("accepts a well-formed document", () => {
    const result = scanHtml(VALID);
    expect(result.isValid).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.reports).toEqual(["✅ HTML structure looks valid and well-formed"]);
  });

  test("reports every missing structural element on an empty document", () => {
    const result = scanHtml("<p>hi</p>");
    const types = result.issues.map((i) => i.type);
    expect(types).toEqual(
      expect.arrayContaining([
        "missing_doctype",
        "missing_charset",
        "missing_viewport",
        "missing_title",
        "missing_lang",
      ])
    );
    expect(result.isValid).toBe(false);
  });

  test("flags images without alt text with the source in the suggestion", () => {
    const result = scanHtml(`${VALID}\n<img src="pic.jpg">`);
    const issue = result.issues.find((i) => i.type === "missing_alt_text");
    expect(issue?.severity).toBe("high");
    expect(issue?.suggestion).toContain("pic.jpg");
    expect(issue?.line).toBeGreaterThan(1);
  });

  test("flags deprecated tags with their line number", () => {
    const result = scanHtml(`${VALID}\n<center>x</center>`);
    const issue = result.issues.find((i) => i.type === "deprecated_tags");
    expect(issue?.element).toBe("center");
  });

  test("flags empty style attributes as low severity", () => {
    const result = scanHtml(`${VALID}\n<div style=""></div>`);
    const issue = result.issues.find((i) => i.type === "unused_attributes");
    expect(issue?.severity).toBe("low");
  });

  test("counts images, links, scripts and stylesheets", () => {
    const html = `${VALID}\n<script src="a.js"></script>\n<link rel="stylesheet" href="a.css">\n<a>bare</a>`;
    const { statistics } = scanHtml(html);
    expect(statistics.images).toBe(1);
    expect(statistics.links).toBeGreaterThanOrEqual(2);
    expect(statistics.scripts).toBe(1);
    expect(statistics.stylesheets).toBe(1);
    expect(statistics.totalElements).toBeGreaterThan(0);
  });
});
