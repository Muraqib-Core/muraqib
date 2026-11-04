import { beforeEach, describe, expect, it, vi } from "vitest";

type ExecCallback = (error: Error | null, result?: { stdout: string; stderr: string }) => void;

const execFileMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ execFile: execFileMock }));

import { DockerImageScanner } from "../../../src/scan/scanners/docker/image-engine.js";
import { DockerRuntimeScanner } from "../../../src/scan/scanners/docker/runtime-engine.js";

const IMAGE_ID = `sha256:${"b".repeat(64)}`;

describe("default command runners", () => {
  beforeEach(() => {
    execFileMock.mockReset();
  });

  it("image scanner shells out through execFile and returns the report", async () => {
    const report = JSON.stringify({ Results: [{ Target: "t", Vulnerabilities: [] }] });
    execFileMock.mockImplementation((command: string, _args: string[], _opts: object, cb: ExecCallback) => {
      cb(null, { stdout: command === "docker" ? IMAGE_ID : report, stderr: "" });
    });
    const result = await new DockerImageScanner().scan("app:latest");
    expect(result.status).toBe("success");
    expect(execFileMock.mock.calls.map((c) => c[0])).toEqual(["docker", "trivy"]);
  });

  it("image scanner reports unavailable when execFile fails", async () => {
    execFileMock.mockImplementation((_c: string, _a: string[], _o: object, cb: ExecCallback) => cb(new Error("no docker")));
    const result = await new DockerImageScanner().scan("app:latest");
    expect(result.status).toBe("unavailable");
  });

  it("runtime scanner inspects a container through execFile", async () => {
    const inspect = JSON.stringify([{ Id: "abcdef1234567890", HostConfig: { Privileged: true } }]);
    execFileMock.mockImplementation((_c: string, _a: string[], _o: object, cb: ExecCallback) => cb(null, { stdout: inspect, stderr: "" }));
    const result = await new DockerRuntimeScanner().scan("web");
    expect(result.status).toBe("success");
    expect(result.findings).toHaveLength(1);
  });

  it("runtime scanner reports unavailable when execFile fails", async () => {
    execFileMock.mockImplementation((_c: string, _a: string[], _o: object, cb: ExecCallback) => cb(new Error("boom")));
    const result = await new DockerRuntimeScanner().scan("web");
    expect(result.status).toBe("unavailable");
  });
});
