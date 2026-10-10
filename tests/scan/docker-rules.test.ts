import test from "node:test";
import assert from "node:assert";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { DockerScanner } from "../../src/scan/scanners/docker/docker-engine.js";

async function scanDockerfile(dir: string, name: string, content: string): Promise<string[]> {
  await fs.writeFile(path.join(dir, name), content);
  const result = await new DockerScanner().scan({ projectPath: dir, files: [], dockerfiles: [name] });
  return result.findings.map((f) => f.code);
}

test("Docker IM-02 end-of-life base image and IM-03 root user", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "docker-rules-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  await t.test("IM-02 flags end-of-life official images", async () => {
    for (const image of ["node:14", "node:18-alpine", "node:20.11.1", "python:3.8-slim", "python:3.9", "ubuntu:20.04", "ubuntu:18.04", "debian:11-slim", "docker.io/library/node:16"]) {
      assert.ok((await scanDockerfile(dir, "Dockerfile.eol", `FROM ${image}\nUSER app\n`)).includes("IM-02"), image);
    }
  });

  await t.test("IM-02 ignores supported, unversioned and unrelated images", async () => {
    for (const image of ["node:22", "node:24-alpine", "python:3.10", "python:3.12-slim", "ubuntu:22.04", "ubuntu:24.04", "debian:12", "node:lts", "alpine:3.12", "myorg/node:14", "scratch"]) {
      assert.ok(!(await scanDockerfile(dir, "Dockerfile.ok", `FROM ${image}\nUSER app\n`)).includes("IM-02"), image);
    }
  });

  await t.test("IM-02 resolves ARG-based tags and skips stage aliases", async () => {
    assert.ok((await scanDockerfile(dir, "Dockerfile.arg", "ARG BASE=node:14\nFROM ${BASE}\nUSER app\n")).includes("IM-02"));
    const ids = await scanDockerfile(dir, "Dockerfile.alias", "FROM node:22 AS node\nFROM node\nUSER app\n");
    assert.ok(!ids.includes("IM-02"));
  });

  await t.test("IM-03 flags images with no USER or an explicit root USER", async () => {
    assert.ok((await scanDockerfile(dir, "Dockerfile.nouser", "FROM node:22\nCMD [\"node\"]\n")).includes("IM-03"));
    for (const user of ["root", "0", "root:root", "0:0"]) {
      assert.ok((await scanDockerfile(dir, "Dockerfile.root", `FROM node:22\nUSER ${user}\n`)).includes("IM-03"), user);
    }
    assert.ok((await scanDockerfile(dir, "Dockerfile.back", "FROM node:22\nUSER app\nUSER root\n")).includes("IM-03"));
  });

  await t.test("IM-03 accepts a non-root USER, including numeric and variable users", async () => {
    for (const user of ["node", "1000", "app:app", "$APP_USER"]) {
      assert.ok(!(await scanDockerfile(dir, "Dockerfile.user", `FROM node:22\nUSER ${user}\n`)).includes("IM-03"), user);
    }
  });

  await t.test("IM-03 only judges the final stage and follows inheritance", async () => {
    const builderRoot = "FROM node:22 AS build\nRUN npm ci\nFROM node:22\nUSER app\n";
    assert.ok(!(await scanDockerfile(dir, "Dockerfile.multi", builderRoot)).includes("IM-03"));
    const inherited = "FROM node:22 AS base\nUSER app\nFROM base\nCMD [\"node\"]\n";
    assert.ok(!(await scanDockerfile(dir, "Dockerfile.inherit", inherited)).includes("IM-03"));
    const finalRoot = "FROM node:22 AS build\nUSER app\nFROM node:22\nCMD [\"node\"]\n";
    assert.ok((await scanDockerfile(dir, "Dockerfile.finalroot", finalRoot)).includes("IM-03"));
  });

  await t.test("IM-03 skips scratch images", async () => {
    assert.ok(!(await scanDockerfile(dir, "Dockerfile.scratch", "FROM scratch\nCOPY app /app\n")).includes("IM-03"));
  });
});
