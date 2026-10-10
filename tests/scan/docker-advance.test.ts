import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DockerScanner } from "../../src/scan/scanners/docker/docker-engine.js";
import { DockerImageScanner, parseTrivyReport } from "../../src/scan/scanners/docker/image-engine.js";
import { DockerRuntimeScanner, analyzeContainer } from "../../src/scan/scanners/docker/runtime-engine.js";

const imageId = `sha256:${"a".repeat(64)}`;

test("image scanner normalizes installed package advisories without returning raw data", async () => {
  const data = { Results: [{ Target: "debian:12", Type: "debian", Vulnerabilities: [{ VulnerabilityID: "CVE-2099-1234", PkgName: "libdemo", InstalledVersion: "1.0", FixedVersion: "1.1", Severity: "HIGH", SeveritySource: "debian" }] }] };
  assert.equal(parseTrivyReport(data, imageId)[0]?.level, "high");
  const calls: string[] = [];
  const scanner = new DockerImageScanner(async (command, args) => {
    calls.push(`${command} ${args.join(" ")}`);
    return command === "docker" ? imageId : JSON.stringify(data);
  });
  const result = await scanner.scan("local:demo");
  assert.equal(result.status, "success");
  assert.equal(result.findings[0]?.code, "CVE-2099-1234");
  assert.deepEqual(result.scannedInputs, [imageId]);
  assert.ok(calls.some(c => c.includes("--image-src docker")));
  assert.ok(calls.every(c => !c.includes("pull")));
});

test("image scanner marks unavailable and malformed analysis honestly", async () => {
  const missing = await new DockerImageScanner(async () => { throw new Error("private token in stderr"); }).scan("local:demo");
  assert.equal(missing.status, "unavailable");
  assert.doesNotMatch(JSON.stringify(missing), /private token/);
  const malformed = await new DockerImageScanner(async (cmd) => cmd === "docker" ? imageId : "{}").scan("local:demo");
  assert.equal(malformed.status, "failed");
});

test("runtime scanner reports observed privileges without changing a container", async () => {
  const observed = { Id: "b".repeat(64), Config: { User: "root" }, HostConfig: { Privileged: true, CapAdd: ["SYS_ADMIN"], NetworkMode: "host" }, Mounts: [{ Source: "/var/run/docker.sock" }] };
  assert.equal(analyzeContainer(observed).length, 5);
  const calls: string[][] = [];
  const result = await new DockerRuntimeScanner(async (_command, args) => { calls.push(args); return JSON.stringify([observed]); }).scan("demo");
  assert.equal(result.status, "success");
  assert.deepEqual(calls, [["inspect", "--type", "container", "demo"]]);
  assert.ok(result.findings.some(f => f.code === "RT-DOCKER-SOCKET"));
  const unavailable = await new DockerRuntimeScanner(async () => { throw new Error("secret daemon URL"); }).scan("demo");
  assert.equal(unavailable.status, "unavailable");
  assert.doesNotMatch(JSON.stringify(unavailable), /secret daemon URL/);
});

test("static scanner treats an inaccessible requested Compose build context as partial", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "muraqib-context-"));
  try {
    await fs.writeFile(path.join(dir, "compose.yaml"), "services:\n  app:\n    build: ./missing\n");
    const scanner = new DockerScanner(async (_args) => {
      if (_args[0] === "--version") return "Docker";
      return JSON.stringify({ services: { app: { build: { context: path.join(dir, "missing") } } } });
    });
    const result = await scanner.scan({ projectPath: dir, files: [], composeFiles: ["compose.yaml"] });
    assert.equal(result.status, "partial");
    assert.ok(result.diagnostics?.some(d => d.includes("inaccessible")));
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test("static scanner never forwards raw external errors to diagnostics", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "muraqib-redact-"));
  try {
    await fs.writeFile(path.join(dir, "compose.yaml"), "services:\n  app:\n    image: demo:1\n");
    const scanner = new DockerScanner(async (args) => {
      if (args[0] === "--version") return "Docker";
      throw new Error("SECRET_PASSWORD=do-not-print");
    }, true);
    const result = await scanner.scan({ projectPath: dir, files: [], composeFiles: ["compose.yaml"] });
    assert.equal(result.status, "partial");
    assert.doesNotMatch(JSON.stringify(result), /do-not-print/);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test("default Docker audit never calls Docker CLI", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "muraqib-offline-"));
  try {
    await fs.writeFile(path.join(dir, "Dockerfile"), "FROM alpine:3.20\n");
    const result = await new DockerScanner(async () => { throw new Error("Docker CLI must not run"); })
      .scan({ projectPath: dir, files: [], dockerfiles: ["Dockerfile"] });
    assert.equal(result.status, "success");
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test("Compose overrides are resolved together only with native opt in", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "muraqib-overrides-"));
  try {
    await fs.writeFile(path.join(dir, "compose.yaml"), "services:\n  app:\n    image: demo:1\n");
    await fs.writeFile(path.join(dir, "compose.override.yaml"), "services:\n  app:\n    privileged: true\n");
    const context = { projectPath: dir, files: [], composeFiles: ["compose.yaml", "compose.override.yaml"] };
    const offline = await new DockerScanner(async () => { throw new Error("should not run"); }).scan(context);
    assert.equal(offline.status, "partial");
    assert.ok(!offline.findings.some(f => f.code === "PR-02"));
    const calls: string[][] = [];
    const online = await new DockerScanner(async args => {
      calls.push(args);
      return args[0] === "--version" ? "Docker" : JSON.stringify({ services: { app: { privileged: true } } });
    }, true).scan(context);
    assert.equal(online.status, "success");
    assert.equal(online.findings.filter(f => f.code === "PR-02").length, 1);
    assert.ok(calls.some(args => args.filter(a => a === "-f").length === 2));
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
