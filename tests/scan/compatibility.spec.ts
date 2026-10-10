import { test } from "vitest";
import assert from "node:assert/strict";
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
