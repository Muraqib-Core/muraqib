import { test } from "vitest";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { CompatibilityEngine } from "../../src/scan/scanners/compatibility/compatibility-engine.js";

test("CompatibilityEngine: detects ecosystem conflict between React 19 and Next.js 13", async () => {
  const engine = new CompatibilityEngine();

  const scanResult = await engine.scan({
    projectPath: process.cwd(),
    files: ["package.json"],
    dependencies: {
      react: "19.0.0",
      next: "13.5.0",
    },
  });

  assert.equal(scanResult.scanner, "compatibility");
  assert.equal(scanResult.status, "success");
  const conflict = scanResult.findings.find(
    (f) => f.category === "compatibility" && f.title.includes("react")
  );
  assert.ok(conflict, "Expected compatibility conflict between react 19 and next 13");
  assert.equal(conflict.level, "medium");
});

test("CompatibilityEngine: passes when dependencies are compatible", async () => {
  const engine = new CompatibilityEngine();

  const scanResult = await engine.scan({
    projectPath: process.cwd(),
    files: ["package.json"],
    dependencies: {
      react: "18.3.1",
      next: "14.2.5",
    },
  });

  assert.equal(scanResult.findings.length, 0);
});

test("CompatibilityEngine: compares versions numerically, not by string prefix", async () => {
  const engine = new CompatibilityEngine();
  const scan = (next: string) =>
    engine.scan({ projectPath: process.cwd(), files: [], dependencies: { react: "^19.0.0", next } });

  assert.equal((await scan("14.1.4")).findings.length, 1);
  assert.equal((await scan("~14.0.0")).findings.length, 1);
  // 14.10 only starts with "14.1" as a string; it is newer than 14.1.
  assert.equal((await scan("14.10.0")).findings.length, 0);
  assert.equal((await scan("15.0.0")).findings.length, 0);
});

test("CompatibilityEngine: evaluates the whole engines.node range against the running Node", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "compat-engines-"));
  const scanWith = async (node: string) => {
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ engines: { node } }));
    return new CompatibilityEngine().scan({ projectPath: dir, files: [] });
  };

  try {
    assert.equal((await scanWith(">=999")).findings[0]?.code, "compat-node-engine-mismatch");
    assert.equal((await scanWith("^999 || ^998")).findings.length, 1);
    assert.equal((await scanWith(">=18 <999")).findings.length, 0);
    assert.equal((await scanWith("not a range")).findings.length, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
