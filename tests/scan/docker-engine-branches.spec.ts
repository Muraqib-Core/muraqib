import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DockerScanner } from "../../src/scan/scanners/docker/docker-engine.js";
import type { ScanResult } from "../../src/scan/core/contracts/scanner-engine.js";

type DockerCall = { args: string[]; cwd: string };

let root: string;

beforeEach(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "muraqib-docker-branches-")));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

async function write(file: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await fs.writeFile(path.join(root, file), content);
}

function scanDockerfiles(...dockerfiles: string[]): Promise<ScanResult> {
  return new DockerScanner().scan({ projectPath: root, files: [], dockerfiles });
}

function scanCompose(scanner: DockerScanner, ...composeFiles: string[]): Promise<ScanResult> {
  return scanner.scan({ projectPath: root, files: [], composeFiles });
}

const codes = (result: ScanResult): string[] => result.findings.map((f) => f.code);

describe("Dockerfile analysis", () => {
  it("flags end-of-life official images and leaves supported ones alone", async () => {
    await write("old.Dockerfile", "FROM node:18\nFROM python:3.9-slim\nFROM ubuntu:20.04\nFROM docker.io/library/debian:11\nUSER app\n");
    await write("new.Dockerfile", "FROM node:22\nFROM python:3.12\nFROM ubuntu:22.04\nFROM debian:12\nFROM node@sha256:abc\nUSER app\n");
    const old = await scanDockerfiles("old.Dockerfile");
    expect(codes(old).filter((c) => c === "IM-02")).toHaveLength(4);
    expect(codes(await scanDockerfiles("new.Dockerfile"))).not.toContain("IM-02");
  });

  it("resolves ARG-based base images and ignores unresolved ones", async () => {
    await write("arg.Dockerfile", "ARG BASE=node:18\nFROM ${BASE}\nUSER app\n");
    await write("unknown.Dockerfile", "FROM ${MISSING}\nUSER app\n");
    expect(codes(await scanDockerfiles("arg.Dockerfile"))).toContain("IM-02");
    expect(codes(await scanDockerfiles("unknown.Dockerfile"))).toEqual([]);
  });

  it("reports root only for the final non-scratch stage and honours inherited users", async () => {
    await write("root.Dockerfile", "FROM alpine:3\nUSER root\n");
    await write("zero.Dockerfile", "FROM alpine:3\nUSER 0:0\n");
    await write("none.Dockerfile", "FROM alpine:3\n");
    await write("scratch.Dockerfile", "FROM scratch\nCOPY app /app\n");
    await write("var.Dockerfile", "FROM alpine:3\nUSER $RUNTIME_USER\n");
    await write("inherit.Dockerfile", "FROM alpine:3 AS base\nUSER app\nFROM base\n");
    await write("inherit-root.Dockerfile", "FROM alpine:3 AS base\nFROM base\n");
    expect(codes(await scanDockerfiles("root.Dockerfile"))).toContain("IM-03");
    expect(codes(await scanDockerfiles("zero.Dockerfile"))).toContain("IM-03");
    expect(codes(await scanDockerfiles("none.Dockerfile"))).toContain("IM-03");
    expect(codes(await scanDockerfiles("scratch.Dockerfile"))).not.toContain("IM-03");
    expect(codes(await scanDockerfiles("var.Dockerfile"))).not.toContain("IM-03");
    expect(codes(await scanDockerfiles("inherit.Dockerfile"))).not.toContain("IM-03");
    expect(codes(await scanDockerfiles("inherit-root.Dockerfile"))).toContain("IM-03");
  });

  it("joins continuation lines, skips comments and honours --platform", async () => {
    await write(
      "multi.Dockerfile",
      "# comment\nFROM --platform=linux/amd64 alpine:latest AS build\nENV \\\n  API_TOKEN=abc\nUSER app\n",
    );
    const result = await scanDockerfiles("multi.Dockerfile");
    expect(codes(result)).toEqual(expect.arrayContaining(["IM-01", "SE-01"]));
    expect(result.findings.find((f) => f.code === "SE-01")?.location?.line).toBe(3);
  });

  it("skips Dockerfiles outside the project, oversized ones and symlinks that escape", async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "muraqib-outside-"));
    try {
      await fs.writeFile(path.join(outside, "Dockerfile"), "FROM alpine:3\n");
      await fs.symlink(path.join(outside, "Dockerfile"), path.join(root, "link.Dockerfile"));
      await write("huge.Dockerfile", `FROM alpine:3\n#${"x".repeat(1024 * 1024)}\n`);
      const result = await scanDockerfiles("../escape.Dockerfile", "link.Dockerfile", "huge.Dockerfile");
      expect(result.status).toBe("partial");
      expect(result.skippedInputs).toEqual(["../escape.Dockerfile", "link.Dockerfile", "huge.Dockerfile"]);
      expect(result.diagnostics?.[0]).toContain("outside project");
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });
});

describe("Docker-native validation", () => {
  it("reports an unavailable CLI as partial but still runs static rules", async () => {
    await write("Dockerfile", "FROM alpine:latest\nUSER app\n");
    const scanner = new DockerScanner(async () => {
      throw new Error("no docker");
    }, true);
    const result = await scanner.scan({ projectPath: root, files: [], dockerfiles: ["Dockerfile"] });
    expect(result.status).toBe("partial");
    expect(codes(result)).toContain("IM-01");
    expect(result.diagnostics?.[0]).toContain("Docker-native validation is unavailable");
  });

  it("runs build --check and reports a failed check without losing findings", async () => {
    await write("Dockerfile", "FROM alpine:latest\nUSER app\n");
    const calls: DockerCall[] = [];
    const ok = new DockerScanner(async (args, cwd) => {
      calls.push({ args, cwd });
      return "";
    }, true);
    expect((await ok.scan({ projectPath: root, files: [], dockerfiles: ["Dockerfile"] })).status).toBe("success");
    expect(calls.map((c) => c.args[0])).toEqual(["--version", "build"]);

    const failing = new DockerScanner(async (args) => {
      if (args[0] === "build") throw new Error("lint failed");
      return "";
    }, true);
    const result = await failing.scan({ projectPath: root, files: [], dockerfiles: ["Dockerfile"] });
    expect(result.status).toBe("partial");
    expect(result.diagnostics?.some((d) => d.includes("build validation could not complete"))).toBe(true);
  });
});

describe("Compose analysis", () => {
  const plain = new DockerScanner();

  it("flags host namespaces, broad capabilities and long-syntax socket mounts", async () => {
    await write(
      "compose.yaml",
      [
        "services:",
        "  a: { image: x, network_mode: host }",
        "  b: { image: x, pid: host }",
        "  c: { image: x, ipc: host }",
        "  d: { image: x, cap_add: [SYS_ADMIN] }",
        "  e: { image: x, cap_add: [NET_BIND_SERVICE] }",
        "  f: { image: x, volumes: [{ type: bind, source: /run/docker.sock, target: /sock }] }",
        "  g: { image: x, volumes: [{ type: volume, target: /data }, ./data:/data] }",
        "  h: null",
        "",
      ].join("\n"),
    );
    const result = await scanCompose(plain, "compose.yaml");
    expect(codes(result).filter((c) => c === "PR-04")).toHaveLength(3);
    expect(codes(result).filter((c) => c === "PR-03")).toHaveLength(1);
    expect(codes(result).filter((c) => c === "PR-05")).toHaveLength(1);
  });

  it("reports compose files that are outside the project, too large or escape via symlink", async () => {
    await write("big.yaml", `services: {}\n#${"x".repeat(1024 * 1024)}\n`);
    const result = await scanCompose(plain, "../outside.yaml", "big.yaml", "missing.yaml");
    expect(result.status).toBe("partial");
    expect(result.diagnostics?.[0]).toContain("outside project");
    expect(codes(result).filter((c) => c === "CO-01")).toHaveLength(2);
  });

  it("does not merge overrides without Docker and says so", async () => {
    await write("compose.yaml", "services:\n  app: { image: x }\n");
    await write("compose.override.yaml", "services:\n  app: { privileged: true }\n");
    const result = await scanCompose(plain, "compose.yaml", "compose.override.yaml");
    expect(result.status).toBe("partial");
    expect(result.scannedInputs).toEqual(["compose.yaml", "compose.override.yaml"]);
    expect(result.diagnostics?.some((d) => d.includes("require Docker Compose"))).toBe(true);
  });

  it("scans an override on its own when no base file exists and honours the docker- prefix", async () => {
    await write("compose.override.yaml", "services:\n  app: { image: x, privileged: true }\n");
    await write("docker-compose.yml", "services:\n  app: { image: x }\n");
    await write("docker-compose.override.yml", "services:\n  app: { image: x }\n");
    const lone = await scanCompose(plain, "compose.override.yaml");
    expect(codes(lone)).toContain("PR-02");
    const prefixed = await scanCompose(plain, "docker-compose.yml", "docker-compose.override.yml");
    expect(prefixed.scannedInputs).toEqual(["docker-compose.yml", "docker-compose.override.yml"]);
  });

  it("fails the file when an override cannot be read", async () => {
    await write("compose.yaml", "services:\n  app: { image: x }\n");
    await write("compose.override.yaml", "services: [unclosed\n");
    const result = await scanCompose(plain, "compose.yaml", "compose.override.yaml");
    expect(codes(result)).toContain("CO-01");
  });

  it("uses the effective model from Docker Compose and drops duplicate literal findings", async () => {
    await write("compose.yaml", "services:\n  app: { image: x, privileged: true }\n");
    await write("compose.override.yaml", "services:\n  app: { privileged: false }\n");
    const calls: DockerCall[] = [];
    const scanner = new DockerScanner(async (args, cwd) => {
      calls.push({ args, cwd });
      return JSON.stringify({ services: { app: { image: "x", privileged: true } } });
    }, true);
    const result = await scanCompose(scanner, "compose.yaml", "compose.override.yaml");
    expect(codes(result).filter((c) => c === "PR-02")).toHaveLength(1);
    const compose = calls.find((c) => c.args[0] === "compose");
    expect(compose?.args).toEqual(expect.arrayContaining(["-f", path.join(root, "compose.yaml"), path.join(root, "compose.override.yaml")]));
  });

  it("falls back to the parsed file when the effective model is unavailable", async () => {
    await write("compose.yaml", "services:\n  app: { image: x, privileged: true }\n");
    for (const output of ["not json", "{}", "null"]) {
      const scanner = new DockerScanner(async (args) => (args[0] === "compose" ? output : ""), true);
      const result = await scanCompose(scanner, "compose.yaml");
      expect(result.status).toBe("partial");
      expect(result.diagnostics?.some((d) => d.includes("Effective Compose model unavailable"))).toBe(true);
      expect(codes(result)).toContain("PR-02");
    }
    const throwing = new DockerScanner(async (args) => {
      if (args[0] === "compose") throw new Error("boom");
      return "";
    }, true);
    await write("compose.override.yaml", "services: {}\n");
    const merged = await scanCompose(throwing, "compose.yaml", "compose.override.yaml");
    expect(codes(merged)).not.toContain("PR-02");
  });
});

describe("Compose build contexts", () => {
  const scanner = new DockerScanner();

  async function scanBuild(build: string, extra: string[] = []): Promise<ScanResult> {
    await write("compose.yaml", `services:\n  app:\n    build: ${build}\n${extra.join("\n")}`);
    return scanCompose(scanner, "compose.yaml");
  }

  it("reports a sensitive file copied by COPY . when it is not ignored", async () => {
    await write(".env", "SECRET=1\n");
    await write("Dockerfile", "FROM alpine:3\nCOPY . /app\nUSER app\n");
    const result = await scanBuild(".");
    const hit = result.findings.find((f) => f.code === "IM-05");
    expect(hit?.location).toMatchObject({ file: "Dockerfile", line: 2 });
  });

  it("respects .dockerignore, per-Dockerfile ignore files and narrow COPY sources", async () => {
    await write(".env", "SECRET=1\n");
    await write("Dockerfile", "FROM alpine:3\nCOPY . /app\nUSER app\n");
    await write(".dockerignore", ".env\n");
    expect(codes(await scanBuild("."))).not.toContain("IM-05");

    await fs.rm(path.join(root, ".dockerignore"));
    await write("Dockerfile.dockerignore", ".env*\n");
    expect(codes(await scanBuild("."))).not.toContain("IM-05");

    await fs.rm(path.join(root, "Dockerfile.dockerignore"));
    await write("Dockerfile", "FROM alpine:3\nCOPY src /app\nCOPY --from=build /x /y\nUSER app\n");
    expect(codes(await scanBuild("."))).not.toContain("IM-05");
  });

  it("matches wildcard, bracket-form and flagged COPY/ADD instructions", async () => {
    await write(".env.production", "SECRET=1\n");
    await write("Dockerfile", 'FROM alpine:3\nCOPY --chown=app:app .env* /app/\nADD [".env.production", "/app/"]\nUSER app\n');
    const result = await scanBuild(".");
    expect(codes(result).filter((c) => c === "IM-05")).toHaveLength(2);
  });

  it("marks unsupported COPY forms as incomplete", async () => {
    await write(".env", "SECRET=1\n");
    await write("Dockerfile", 'FROM alpine:3\nCOPY onlyone\nCOPY ["a"]\nCOPY [broken\nUSER app\n');
    const result = await scanBuild(".");
    expect(result.status).toBe("partial");
    expect(result.diagnostics?.some((d) => d.includes("COPY form unsupported"))).toBe(true);
  });

  it("supports the long build syntax with a custom Dockerfile", async () => {
    await write(".env", "SECRET=1\n");
    await write("docker/app.Dockerfile", "FROM alpine:3\nCOPY .env /app/.env\nUSER app\n");
    const result = await scanBuild("\n      context: .\n      dockerfile: docker/app.Dockerfile");
    expect(result.findings.find((f) => f.code === "IM-05")?.location?.file).toBe(path.join("docker", "app.Dockerfile"));
  });

  it("skips unsupported, missing and escaping contexts with a diagnostic", async () => {
    for (const [build, message] of [
      ["https://example.com/repo.git", "unsupported or unresolved"],
      ["./missing-dir", "inaccessible"],
      ["..", "outside project"],
    ] as const) {
      const result = await scanBuild(build);
      expect(result.status).toBe("partial");
      expect(result.diagnostics?.some((d) => d.includes(message))).toBe(true);
    }
  });

  it("skips builds whose Dockerfile or ignore file cannot be used", async () => {
    await write("sub/placeholder", "");
    expect((await scanBuild("sub")).diagnostics?.some((d) => d.includes("Dockerfile inaccessible"))).toBe(true);

    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "muraqib-outside-"));
    try {
      await fs.writeFile(path.join(outside, "Dockerfile"), "FROM alpine:3\n");
      await fs.symlink(path.join(outside, "Dockerfile"), path.join(root, "sub", "Dockerfile"));
      expect((await scanBuild("sub")).diagnostics?.some((d) => d.includes("Dockerfile outside project"))).toBe(true);
      await fs.rm(path.join(root, "sub", "Dockerfile"));

      await write("sub/Dockerfile", "FROM alpine:3\n");
      await fs.writeFile(path.join(outside, "ignore"), ".env\n");
      await fs.symlink(path.join(outside, "ignore"), path.join(root, "sub", ".dockerignore"));
      expect((await scanBuild("sub")).diagnostics?.some((d) => d.includes("Ignore file outside project"))).toBe(true);
      await fs.rm(path.join(root, "sub", ".dockerignore"));
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }

    await write("sub/.dockerignore", `${"#".repeat(1024 * 1024 + 1)}\n`);
    expect((await scanBuild("sub")).diagnostics?.some((d) => d.includes("Ignore file too large"))).toBe(true);
    await fs.rm(path.join(root, "sub", ".dockerignore"));

    await fs.mkdir(path.join(root, "sub", ".dockerignore"));
    expect((await scanBuild("sub")).diagnostics?.some((d) => d.includes("Ignore file unreadable"))).toBe(true);
  });

  it("skips sensitive files that are symlinks leaving the context", async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "muraqib-outside-"));
    try {
      await fs.writeFile(path.join(outside, "secret"), "x");
      await write("sub/Dockerfile", "FROM alpine:3\nCOPY . /app\nUSER app\n");
      await fs.symlink(path.join(outside, "secret"), path.join(root, "sub", ".env"));
      const result = await scanBuild("sub");
      expect(result.diagnostics?.some((d) => d.includes("Sensitive candidate symlink skipped"))).toBe(true);
      expect(codes(result)).not.toContain("IM-05");
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });
});
