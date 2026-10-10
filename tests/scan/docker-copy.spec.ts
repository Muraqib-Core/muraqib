import { describe, test, beforeAll, afterAll } from "vitest";
import assert from "node:assert";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { DockerScanner } from "../../src/scan/scanners/docker/docker-engine.js";

describe("DockerScanner COPY analysis", () => {
  let tmpDir = "";
  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "muraqib-docker-copy-test-"));
  });
  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

    // Scenario 1: COPY . /app with .env present and not ignored
    test("Broad copy includes unignored .env", async () => {
      const projPath = path.join(tmpDir, "scen1");
      await fs.mkdir(projPath);
      await fs.writeFile(path.join(projPath, "docker-compose.yml"), `
services:
  web:
    build: .
`);
      await fs.writeFile(path.join(projPath, "Dockerfile"), `
FROM node:18
COPY . /app
`);
      await fs.writeFile(path.join(projPath, ".env"), "SECRET=true");

      const scanner = new DockerScanner();
      const result = await scanner.scan({
        projectPath: projPath,
        files: ["docker-compose.yml", "Dockerfile", ".env"],
        dockerfiles: ["Dockerfile"],
        composeFiles: ["docker-compose.yml"],
        packageManager: "npm",
        dependencies: {},
        devDependencies: {},
        dockerignoreFiles: []
      });

      const copyFinding = result.findings.find(f => f.code === "IM-05");
      assert.ok(copyFinding, "Should find IM-05");
      assert.match(copyFinding.message, /copies unignored sensitive file "\.env"/);
    });

    // Scenario 2: .dockerignore excludes .env
    test(".dockerignore excludes .env", async () => {
      const projPath = path.join(tmpDir, "scen2");
      await fs.mkdir(projPath);
      await fs.writeFile(path.join(projPath, "docker-compose.yml"), `
services:
  web:
    build: .
`);
      await fs.writeFile(path.join(projPath, "Dockerfile"), `
FROM node:18
COPY . /app
`);
      await fs.writeFile(path.join(projPath, ".env"), "SECRET=true");
      await fs.writeFile(path.join(projPath, ".dockerignore"), ".env\n");

      const scanner = new DockerScanner();
      const result = await scanner.scan({
        projectPath: projPath,
        files: ["docker-compose.yml", "Dockerfile", ".env", ".dockerignore"],
        dockerfiles: ["Dockerfile"],
        composeFiles: ["docker-compose.yml"],
        packageManager: "npm",
        dependencies: {},
        devDependencies: {},
        dockerignoreFiles: [".dockerignore"]
      });

      const copyFinding = result.findings.find(f => f.code === "IM-05");
      assert.ok(!copyFinding, "Should not find IM-05 because .env is ignored");
    });

    // Scenario 3: Dockerfile-specific ignore file takes precedence
    test("Dockerfile-specific ignore file takes precedence", async () => {
      const projPath = path.join(tmpDir, "scen3");
      await fs.mkdir(projPath);
      await fs.writeFile(path.join(projPath, "docker-compose.yml"), `
services:
  web:
    build:
      context: .
      dockerfile: dev.Dockerfile
`);
      await fs.writeFile(path.join(projPath, "dev.Dockerfile"), `
FROM node:18
COPY . /app
`);
      await fs.writeFile(path.join(projPath, ".env"), "SECRET=true");
      // .dockerignore ignores it
      await fs.writeFile(path.join(projPath, ".dockerignore"), ".env\n");
      // dev.Dockerfile.dockerignore DOES NOT ignore it (e.g. negates it)
      await fs.writeFile(path.join(projPath, "dev.Dockerfile.dockerignore"), "!.env\n");

      const scanner = new DockerScanner();
      const result = await scanner.scan({
        projectPath: projPath,
        files: ["docker-compose.yml", "dev.Dockerfile", ".env", ".dockerignore", "dev.Dockerfile.dockerignore"],
        dockerfiles: ["dev.Dockerfile"],
        composeFiles: ["docker-compose.yml"],
        packageManager: "npm",
        dependencies: {},
        devDependencies: {},
        dockerignoreFiles: [".dockerignore", "dev.Dockerfile.dockerignore"]
      });

      const copyFinding = result.findings.find(f => f.code === "IM-05");
      assert.ok(copyFinding, "Should find IM-05 because dev.Dockerfile.dockerignore negates the ignore");
    });

    // Scenario 4: COPY --from=builder ...
    test("COPY --from is ignored for local context analysis", async () => {
      const projPath = path.join(tmpDir, "scen4");
      await fs.mkdir(projPath);
      await fs.writeFile(path.join(projPath, "docker-compose.yml"), `
services:
  web:
    build: .
`);
      await fs.writeFile(path.join(projPath, "Dockerfile"), `
FROM node:18 AS builder
COPY src /src
FROM node:18
COPY --from=builder /src/.env /app/.env
`);
      await fs.writeFile(path.join(projPath, ".env"), "SECRET=true");

      const scanner = new DockerScanner();
      const result = await scanner.scan({
        projectPath: projPath,
        files: ["docker-compose.yml", "Dockerfile", ".env"],
        dockerfiles: ["Dockerfile"],
        composeFiles: ["docker-compose.yml"],
        packageManager: "npm",
        dependencies: {},
        devDependencies: {},
        dockerignoreFiles: []
      });

      const copyFinding = result.findings.find(f => f.code === "IM-05");
      assert.ok(!copyFinding, "Should not find IM-05 because local .env was not copied by local COPY");
    });

});
