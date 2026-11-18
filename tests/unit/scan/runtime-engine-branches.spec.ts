import { describe, expect, it } from "vitest";
import { analyzeContainer, DockerRuntimeScanner } from "../../../src/scan/scanners/docker/runtime-engine.js";
import type { CommandRunner } from "../../../src/scan/scanners/docker/image-engine.js";

const ids = (input: unknown): string[] => analyzeContainer(input).map((f) => f.code);
const base = { Id: "abcdef1234567890", HostConfig: {} };

describe("analyzeContainer branches", () => {
  it("rejects invalid inspect results", () => {
    expect(() => analyzeContainer(null)).toThrow();
    expect(() => analyzeContainer({ HostConfig: {} })).toThrow();
    expect(() => analyzeContainer({ Id: "x" })).toThrow();
  });

  it("reports nothing for a hardened container", () => {
    expect(ids({ ...base, Mounts: [{ Source: "/data" }], Config: { User: "app" } })).toEqual([]);
    expect(ids({ ...base, Config: {} })).toEqual([]);
  });

  it("flags privileged mode and docker socket mounts", () => {
    expect(ids({ ...base, HostConfig: { Privileged: true } })).toHaveLength(1);
    expect(ids({ ...base, Mounts: [{ Source: "/var/run/docker.sock" }] })).toHaveLength(1);
    expect(ids({ ...base, Mounts: [{ Source: "/run/docker.sock" }] })).toHaveLength(1);
  });

  it("flags broad capabilities only", () => {
    expect(ids({ ...base, HostConfig: { CapAdd: null } })).toEqual([]);
    expect(ids({ ...base, HostConfig: { CapAdd: ["NET_ADMIN"] } })).toEqual([]);
    expect(ids({ ...base, HostConfig: { CapAdd: ["ALL"] } })).toHaveLength(1);
    expect(ids({ ...base, HostConfig: { CapAdd: ["SYS_ADMIN"] } })).toHaveLength(1);
  });

  it("flags shared host namespaces and root users", () => {
    expect(ids({ ...base, HostConfig: { NetworkMode: "host" } })).toHaveLength(1);
    expect(ids({ ...base, HostConfig: { PidMode: "host" } })).toHaveLength(1);
    expect(ids({ ...base, HostConfig: { IpcMode: "host" } })).toHaveLength(1);
    expect(ids({ ...base, Config: { User: "0" } })).toHaveLength(1);
    expect(ids({ ...base, Config: { User: "root" } })).toHaveLength(1);
  });
});

function runnerOf(output: string | Error): CommandRunner {
  return async () => {
    if (output instanceof Error) throw output;
    return output;
  };
}

describe("DockerRuntimeScanner.scan branches", () => {
  it("rejects invalid targets (default runner is never invoked)", async () => {
    const scanner = new DockerRuntimeScanner();
    for (const target of ["", "-x", "a\tb"]) {
      expect((await scanner.scan(target)).status).toBe("failed");
    }
  });

  it("is unavailable on runner errors, bad JSON and bad shapes", async () => {
    for (const out of [new Error("boom"), "nope", "{}", "[]", "[{},{}]", "[{}]"]) {
      const result = await new DockerRuntimeScanner(runnerOf(out)).scan("c");
      expect(result.status).toBe("unavailable");
      expect(result.skippedInputs).toEqual(["c"]);
    }
  });

  it("succeeds with findings for a valid inspect", async () => {
    const out = JSON.stringify([{ Id: "abcdef1234567890", HostConfig: { Privileged: true } }]);
    const result = await new DockerRuntimeScanner(runnerOf(out)).scan("c");
    expect(result.status).toBe("success");
    expect(result.scannedInputs).toEqual(["abcdef123456"]);
    expect(result.findings).toHaveLength(1);
  });
});
