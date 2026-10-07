import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { performDockerAudit } from "./docker-guard.js";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";

describe("Docker Guard", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(process.cwd(), `.temp-docker-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it("detects missing Dockerfile", () => {
    const result = performDockerAudit(tempDir);
    expect(result.isSecure).toBe(false);
    expect(result.reports.some((r) => r.includes("No Dockerfile"))).toBe(true);
  });

  it("detects unpinned base image version", () => {
    const dockerfile = `FROM node:latest
WORKDIR /app
COPY . .
RUN npm ci
CMD ["node", "index.js"]`;

    writeFileSync(join(tempDir, "Dockerfile"), dockerfile);
    const result = performDockerAudit(tempDir);

    expect(result.reports.some((r) => r.includes("latest"))).toBe(true);
  });

  it("accepts pinned base image", () => {
    const dockerfile = `FROM node:18-alpine
WORKDIR /app
COPY . .
RUN npm ci
CMD ["node", "index.js"]`;

    writeFileSync(join(tempDir, "Dockerfile"), dockerfile);
    const result = performDockerAudit(tempDir);

    expect(result.dockerfileIssues).toHaveLength(0);
  });

  it("detects root user execution", () => {
    const dockerfile = `FROM node:18
USER root
WORKDIR /app`;

    writeFileSync(join(tempDir, "Dockerfile"), dockerfile);
    const result = performDockerAudit(tempDir);

    expect(
      result.reports.some((r) => r.includes("root user"))
    ).toBe(true);
  });

  it("detects hardcoded secrets", () => {
    const dockerfile = `FROM node:18
ENV DATABASE_URL=postgres://user:password@localhost:5432/db
RUN echo "api_key=sk_live_1234567890"`;

    writeFileSync(join(tempDir, "Dockerfile"), dockerfile);
    const result = performDockerAudit(tempDir);

    expect(
      result.reports.some((r) => r.includes("Hardcoded secrets"))
    ).toBe(true);
  });

  it("warns about missing HEALTHCHECK", () => {
    const dockerfile = `FROM node:18
WORKDIR /app
COPY . .
RUN npm ci`;

    writeFileSync(join(tempDir, "Dockerfile"), dockerfile);
    const result = performDockerAudit(tempDir);

    expect(result.reports.some((r) => r.includes("HEALTHCHECK"))).toBe(true);
  });

  it("validates dockerignore presence", () => {
    const dockerfile = `FROM node:18
WORKDIR /app`;

    writeFileSync(join(tempDir, "Dockerfile"), dockerfile);
    const result = performDockerAudit(tempDir);

    expect(result.reports.some((r) => r.includes("dockerignore"))).toBe(true);
  });
});
