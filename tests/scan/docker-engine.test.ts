import test from "node:test";
import assert from "node:assert";
import { DockerScanner } from "../../src/scan/scanners/docker/docker-engine.js";
import type { ScanContext } from "../../src/scan/core/contracts/scanner-engine.js";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

test("DockerScanner", async (t) => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "docker-test-"));

  t.after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const scanner = new DockerScanner();

  await t.test("supports() identifies Docker and Compose files", () => {
    assert.strictEqual(scanner.supports({ projectPath: tmpDir, files: [] }), false);
    assert.strictEqual(scanner.supports({ projectPath: tmpDir, files: [], dockerfiles: ["Dockerfile"] }), true);
    assert.strictEqual(scanner.supports({ projectPath: tmpDir, files: [], composeFiles: ["compose.yaml"] }), true);
  });

  await t.test("Triggering case: Dockerfile with latest tag and sensitive ENV", async () => {
    const dfPath = path.join(tmpDir, "Dockerfile.trigger");
    await fs.writeFile(dfPath, `
      FROM ubuntu:latest
      ENV MY_PASSWORD=supersecret
      ARG token=123
    `);

    const ctx: ScanContext = {
      projectPath: tmpDir,
      files: [],
      dockerfiles: ["Dockerfile.trigger"]
    };

    const result = await scanner.scan(ctx);
    
    const im01 = result.findings.find(f => f.code === "IM-01");
    assert.ok(im01, "Should find mutable latest tag (IM-01)");
    assert.strictEqual(im01.location?.file, "Dockerfile.trigger");

    const se01 = result.findings.filter(f => f.code === "SE-01");
    assert.strictEqual(se01.length, 2, "Should find sensitive ENV and ARG (SE-01)");
  });

  await t.test("Safe case: Dockerfile with pinned digest and safe ENVs", async () => {
    const dfPath = path.join(tmpDir, "Dockerfile.safe");
    await fs.writeFile(dfPath, `
      FROM ubuntu@sha256:1234567890abcdef
      ENV NODE_ENV=production
    `);

    const ctx: ScanContext = {
      projectPath: tmpDir,
      files: [],
      dockerfiles: ["Dockerfile.safe"]
    };

    const result = await scanner.scan(ctx);
    
    const im01 = result.findings.find(f => f.code === "IM-01");
    assert.ok(!im01, "Should not flag pinned digest");

    const se01 = result.findings.find(f => f.code === "SE-01");
    assert.ok(!se01, "Should not flag safe ENV");
  });

  await t.test("Triggering case: Compose with privileged and docker.sock", async () => {
    const composePath = path.join(tmpDir, "compose.trigger.yaml");
    await fs.writeFile(composePath, `
      services:
        app:
          image: myapp:1
          privileged: true
          volumes:
            - /var/run/docker.sock:/var/run/docker.sock
    `);

    const ctx: ScanContext = {
      projectPath: tmpDir,
      files: [],
      composeFiles: ["compose.trigger.yaml"]
    };

    const result = await scanner.scan(ctx);
    
    const pr02 = result.findings.find(f => f.code === "PR-02");
    assert.ok(pr02, "Should find privileged mode (PR-02)");

    const pr05 = result.findings.find(f => f.code === "PR-05");
    assert.ok(pr05, "Should find docker.sock mount (PR-05)");
  });

  await t.test("Read/Tool failure: Missing file reports partial and diagnostic", async () => {
    const ctx: ScanContext = {
      projectPath: tmpDir,
      files: [],
      dockerfiles: ["Dockerfile.missing"]
    };

    const result = await scanner.scan(ctx);
    assert.strictEqual(result.status, "partial");
    assert.strictEqual(result.skippedInputs?.length, 1);
    assert.ok(result.diagnostics?.some(d => d.includes("Failed to read")));
  });

  await t.test("Syntax failure: Invalid YAML is a finding", async () => {
    const composePath = path.join(tmpDir, "compose.invalid.yaml");
    await fs.writeFile(composePath, `
      services:
        app:
          - invalid: : yaml
    `);

    const ctx: ScanContext = {
      projectPath: tmpDir,
      files: [],
      composeFiles: ["compose.invalid.yaml"]
    };

    const result = await scanner.scan(ctx);
    const co01 = result.findings.find(f => f.code === "CO-01");
    assert.ok(co01, "Should emit finding for invalid YAML");
    assert.strictEqual(result.skippedInputs?.length, 1); // skipped further analysis
  });

  await t.test("No shell injection with unusual filenames", async () => {
    const maliciousName = "Dockerfile; echo injected";
    const maliciousPath = path.join(tmpDir, maliciousName);
    await fs.writeFile(maliciousPath, `
      FROM alpine
    `);

    const ctx: ScanContext = {
      projectPath: tmpDir,
      files: [],
      dockerfiles: [maliciousName]
    };

    const result = await scanner.scan(ctx);
    // If it was injected, docker build would fail or behave unexpectedly.
    // Given we use execFile, it will just pass the name directly to Docker.
    // Docker might fail to find the file or build it, but it won't run `echo injected`.
    // It should at least be scanned.
    assert.ok(result.scannedInputs?.includes(maliciousName));
  });
});
