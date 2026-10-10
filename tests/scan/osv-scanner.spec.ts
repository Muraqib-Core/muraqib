import { test } from "vitest";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { OsvScanner } from "../../src/scan/scanners/dependency/osv-engine.js";

test("OsvScanner: supports project with package.json", () => {
  const scanner = new OsvScanner();
  assert.ok(scanner.supports({ projectPath: process.cwd(), files: ["package.json"] }));
});

test("OsvScanner: handles missing package.json gracefully without crashing", async () => {
  const scanner = new OsvScanner();
  const result = await scanner.scan({
    projectPath: "/non-existent-directory",
    files: [],
  });

  assert.equal(result.scanner, "osv");
  assert.equal(result.status, "success");
  assert.equal(result.findings.length, 0);
});

test("OsvScanner: returns normalized findings structure", async () => {
  const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), "muraqib-osv-empty-"));
  fs.writeFileSync(path.join(projectPath, "package.json"), '{"dependencies":{}}\n');
  const scanner = new OsvScanner();
  try {
    const result = await scanner.scan({
      projectPath,
      files: ["package.json"],
      dependencies: {},
      devDependencies: {},
    });

    assert.equal(result.scanner, "osv");
    assert.equal(result.status, "success");
    assert.ok(Array.isArray(result.findings));
  } finally {
    fs.rmSync(projectPath, { recursive: true, force: true });
  }
});

test("OsvScanner: does not query unresolved ranges as exact installed versions", async () => {
  const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), "muraqib-osv-range-"));
  fs.writeFileSync(
    path.join(projectPath, "package.json"),
    '{"dependencies":{"example-package":">=1 <3"}}\n'
  );

  try {
    const result = await new OsvScanner().scan({ projectPath, files: ["package.json"] });
    assert.equal(result.status, "failed");
    assert.equal(result.findings.length, 0);
    assert.match(result.diagnostics?.[0] ?? "", /did not resolve to an exact installed version/);
  } finally {
    fs.rmSync(projectPath, { recursive: true, force: true });
  }
});
