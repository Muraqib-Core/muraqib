import { describe, expect, test } from "vitest";
import { performRenderBlockingAudit } from "../../../src/core/performance/render-blocking.js";

const page = (head: string, body = ""): string =>
  ["<html>", "<head>", head, "</head>", "<body>", body, "</body>", "</html>"].join("\n");

describe("performRenderBlockingAudit", () => {
  test("reports a clean page as optimized", () => {
    const result = performRenderBlockingAudit(page("<title>x</title>"));
    expect(result.isOptimized).toBe(true);
    expect(result.reports).toEqual(["✅ No render-blocking resources detected"]);
  });

  test("flags stylesheets in head that have no media attribute", () => {
    const result = performRenderBlockingAudit(
      page(`<link rel="stylesheet" href="main.css">`)
    );
    expect(result.blockingResources).toContain("main.css");
    expect(result.criticalIssues[0]?.type).toBe("render_blocking_css");
    expect(result.criticalIssues[0]?.severity).toBe("high");
  });

  test("ignores stylesheets that carry a media query", () => {
    const result = performRenderBlockingAudit(
      page(`<link rel="stylesheet" href="print.css" media="print">`)
    );
    expect(result.blockingResources).toEqual([]);
  });

  test("flags synchronous scripts in head as critical", () => {
    const result = performRenderBlockingAudit(page(`<script src="app.js"></script>`));
    expect(result.isOptimized).toBe(false);
    expect(result.criticalIssues[0]).toMatchObject({
      type: "render_blocking_js",
      resource: "app.js",
      severity: "critical",
    });
  });

  test("labels inline synchronous scripts as inline", () => {
    const result = performRenderBlockingAudit(page(`<script>var a = 1;</script>`));
    expect(result.blockingResources).toContain("inline");
  });

  test("accepts deferred and async scripts", () => {
    const result = performRenderBlockingAudit(
      page(`<script src="a.js" defer></script>\n<script src="b.js" async></script>`)
    );
    expect(result.criticalIssues).toEqual([]);
  });

  test("suggests preloading font files declared with @font-face", () => {
    const result = performRenderBlockingAudit(
      page(`@font-face { src: url("font.woff2"); }`)
    );
    const issue = result.criticalIssues.find((i) => i.type === "large_font_files");
    expect(issue?.resource).toBe("font.woff2");
  });

  test("does not suggest a font preload when preload already exists", () => {
    const result = performRenderBlockingAudit(
      page(`<link rel="preload" href="x">\n@font-face { src: url("font.woff2"); }`)
    );
    expect(result.criticalIssues.some((i) => i.type === "large_font_files")).toBe(false);
  });

  test("notes non-async scripts placed in the body", () => {
    const result = performRenderBlockingAudit(
      `<html>\n<head></head>\n<body>\n<script src="late.js"></script>\n`
    );
    expect(result.reports.some((r) => r.includes("late.js"))).toBe(true);
  });

  test("reads a minified single-line document", () => {
    const result = performRenderBlockingAudit(
      `<html><head><script src="a.js"></script><link rel="stylesheet" href="a.css"></head><body></body></html>`
    );
    expect(result.blockingResources).toEqual(["a.js", "a.css"]);
  });

  test("reads a <head> that carries attributes", () => {
    const result = performRenderBlockingAudit(`<html><head lang="en"><script src="a.js"></script></head></html>`);
    expect(result.blockingResources).toEqual(["a.js"]);
  });

  test("accepts defer or async wherever the attribute sits", () => {
    const result = performRenderBlockingAudit(
      page(`<script src="a.js" defer></script>\n<script async src="b.js"></script>\n<script src="c.js" async="async"></script>`)
    );
    expect(result.blockingResources).toEqual([]);
  });

  test("does not mistake a path containing 'defer' for the attribute", () => {
    const result = performRenderBlockingAudit(page(`<script src="/defer/app.js"></script>`));
    expect(result.blockingResources).toEqual(["/defer/app.js"]);
  });

  test("ignores module scripts and non-JavaScript script types", () => {
    const result = performRenderBlockingAudit(
      page(
        [
          `<script type="module" src="m.js"></script>`,
          `<script type="application/ld+json">{"a":1}</script>`,
          `<script type="importmap">{}</script>`,
        ].join("\n")
      )
    );
    expect(result.blockingResources).toEqual([]);
  });

  test("reports the line of the blocking tag", () => {
    const result = performRenderBlockingAudit(page(`<title>x</title>\n<script src="a.js"></script>`));
    expect(result.criticalIssues[0]?.line).toBe(4);
  });
});
