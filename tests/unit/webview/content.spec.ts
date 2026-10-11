import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { CHANGELOG } from "../../../src/webview/content/changelog.js";
import { DEPENDENCY_PURPOSE, createMuraqibContent } from "../../../src/webview/content/muraqib.js";
import { loadPackageInfo, parsePackageInfo } from "../../../src/webview/package-info.js";
import { createNonce, getWebviewHtml } from "../../../src/webview/index.js";

const pkg = JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8")) as {
  version: string;
  dependencies: Record<string, string>;
};

describe("parsePackageInfo", () => {
  const valid = {
    name: "x",
    version: "1.0.0",
    license: "MIT",
    engines: { node: ">=18", npm: ">=9" },
    repository: { url: "git+https://github.com/o/r.git" },
    bugs: { url: "https://github.com/o/r/issues" },
    homepage: "https://github.com/o/r#readme",
    dependencies: { a: "^1.0.0", bad: 3 },
  };

  test("extracts fields, normalises the repository URL and drops non-string ranges", () => {
    expect(parsePackageInfo(valid)).toEqual({
      name: "x",
      version: "1.0.0",
      license: "MIT",
      nodeEngine: ">=18",
      npmEngine: ">=9",
      repositoryUrl: "https://github.com/o/r",
      bugsUrl: "https://github.com/o/r/issues",
      homepage: "https://github.com/o/r#readme",
      dependencies: { a: "^1.0.0" },
    });
  });

  test("keeps optional fields absent when package.json omits them", () => {
    const info = parsePackageInfo({ name: "x", version: "1.0.0", license: "MIT", engines: { node: ">=18" } });
    expect(info).toEqual({ name: "x", version: "1.0.0", license: "MIT", nodeEngine: ">=18", dependencies: {} });
  });

  test.each([null, [], "str", { version: "1", license: "MIT", engines: { node: "1" } }, { name: "x", version: "1", license: "MIT" }])(
    "throws for invalid input %j",
    (raw) => {
      expect(() => parsePackageInfo(raw)).toThrow(/package\.json/);
    }
  );
});

describe("Muraqib page content", () => {
  const info = loadPackageInfo();
  const content = createMuraqibContent(info);

  test("loads this package's own package.json", () => {
    expect(info.version).toBe(pkg.version);
    expect(info.dependencies).toEqual(pkg.dependencies);
  });

  test("has the six approved tabs in order", () => {
    expect(content.tabs.map((t) => t.id)).toEqual([
      "details",
      "features",
      "installation",
      "configuration",
      "requirements",
      "changelog",
    ]);
    expect(content).toMatchObject({ lang: "en", dir: "ltr", version: pkg.version });
  });

  test("Requirements lists every package.json dependency and nothing else", () => {
    const tab = content.tabs.find((t) => t.id === "requirements");
    const table = tab?.blocks.find((b) => b.kind === "table" && b.headers[0] === "Package");
    const listed = table?.kind === "table" ? table.rows.map((row) => (row[0] ?? "").replaceAll("`", "")) : [];
    expect(listed.sort()).toEqual(Object.keys(pkg.dependencies).sort());
  });

  test("every dependency has a documented purpose and no purpose entry is stale", () => {
    expect(Object.keys(DEPENDENCY_PURPOSE).sort()).toEqual(Object.keys(pkg.dependencies).sort());
  });

  test("the newest changelog entry matches the package version", () => {
    expect(CHANGELOG[0]?.version).toBe(pkg.version);
  });

  test("a dependency without a documented purpose still renders", () => {
    const html = JSON.stringify(createMuraqibContent({ ...info, dependencies: { "new-dep": "^1.0.0" } }));
    expect(html).toContain("Runtime dependency");
  });

  test("sidebar and platform rows adapt to the metadata that is available", () => {
    const minimal = createMuraqibContent({
      name: "x",
      version: "9.9.9",
      license: "MIT",
      nodeEngine: ">=20",
      dependencies: {},
    });
    expect(minimal.sidebar).toHaveLength(1);
    expect(JSON.stringify(minimal.tabs)).not.toContain('"npm"');
    expect(content.sidebar.map((g) => g.title)).toEqual(["More info", "Resources"]);
  });
});

describe("getWebviewHtml", () => {
  test("returns the full document using the host's nonce", () => {
    const nonce = createNonce();
    const html = getWebviewHtml(nonce);
    expect(nonce).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain(`script-src 'nonce-${nonce}'`);
    expect(html).toContain(`v${pkg.version}`);
    for (const id of ["details", "features", "installation", "configuration", "requirements", "changelog"]) {
      expect(html).toContain(`id="panel-${id}"`);
    }
  });

  test("rejects a malformed nonce instead of weakening the CSP", () => {
    expect(() => getWebviewHtml("bad nonce")).toThrow(/nonce/i);
  });
});
