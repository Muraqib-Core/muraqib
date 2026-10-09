import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DockerGuard } from "./docker-guard.js";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("DockerGuard (adapter over DockerScanner)", () => {
  let dir: string;

  beforeEach(() => {
    dir = join(tmpdir(), `muraqib-docker-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "x", version: "1.0.0" }));
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const run = () => new DockerGuard({ projectRoot: dir }).run();

  it("skips cleanly when there are no Docker files", async () => {
    const result = await run();
    expect(result.status).toBe("ok");
    expect(result.module).toBe("docker-guard");
  });

  it("flags an unpinned base image", async () => {
    writeFileSync(join(dir, "Dockerfile"), "FROM node:latest\nWORKDIR /app\nCOPY . .\nCMD [\"node\",\"a.js\"]\n");
    const result = await run();
    expect(result.issues.some((i) => i.code === "IM-01")).toBe(true);
  });

  it("flags secrets baked into ENV", async () => {
    writeFileSync(join(dir, "Dockerfile"), "FROM node:22.4.0\nENV API_TOKEN=abc123secret\nCMD [\"node\",\"a.js\"]\n");
    const result = await run();
    expect(result.issues.some((i) => i.code === "SE-01" && i.severity === "error")).toBe(true);
  });

  it("maps findings to AuditIssue with scanner tags", async () => {
    writeFileSync(join(dir, "Dockerfile"), "FROM node:latest\n");
    const result = await run();
    expect(result.issues[0]?.tags.length).toBeGreaterThan(0);
    expect(result.status).not.toBe("ok");
  });
});
