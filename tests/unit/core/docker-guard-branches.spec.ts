import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const state = vi.hoisted(() => ({
  supports: true,
  scanResult: { status: "passed", findings: [] } as {
    status: string;
    findings: unknown[];
    error?: string;
  },
  nativeArgs: [] as unknown[],
}));

vi.mock("../../../src/scan/core/context/project-context.js", () => ({
  createProjectContext: (root: string) => ({
    projectPath: root,
    files: [],
    packageManager: "npm",
    dockerfiles: [],
    composeFiles: [],
    dockerignoreFiles: [],
  }),
}));

vi.mock("../../../src/scan/scanners/docker/docker-engine.js", () => ({
  DockerScanner: class {
    constructor(_rules?: unknown, native?: unknown) {
      state.nativeArgs.push(native);
    }
    supports(): boolean {
      return state.supports;
    }
    async scan(): Promise<unknown> {
      return state.scanResult;
    }
  },
}));

vi.mock("../../../src/scan/bridge.js", () => ({
  enrichIssue: (f: unknown) => f,
}));

import { DockerGuard } from "../../../src/core/docker-guard.js";

describe("DockerGuard branches", () => {
  beforeEach(() => {
    state.supports = true;
    state.scanResult = { status: "passed", findings: [] };
    state.nativeArgs = [];
  });
  afterEach(() => vi.restoreAllMocks());

  it("falls back to cwd and default nativeValidation when no options given", async () => {
    const cwd = vi.spyOn(process, "cwd");
    const result = await new DockerGuard().run();
    expect(cwd).toHaveBeenCalled();
    expect(state.nativeArgs).toEqual([false]);
    expect(result.status).toBe("ok");
  });

  it("passes nativeValidation through", async () => {
    await new DockerGuard({ projectRoot: "/x", nativeValidation: true }).run();
    expect(state.nativeArgs).toEqual([true]);
  });

  it("skips when scanner does not support the project", async () => {
    state.supports = false;
    const result = await new DockerGuard({ projectRoot: "/x" }).run();
    expect(result.status).toBe("ok");
    expect(result.message).toContain("skipped");
  });

  it("reports DOCKER_SCAN_FAILED using scanner error", async () => {
    state.scanResult = { status: "failed", findings: [], error: "boom" };
    const result = await new DockerGuard({ projectRoot: "/x" }).run();
    expect(result.issues[0]?.code).toBe("DOCKER_SCAN_FAILED");
    expect(result.issues[0]?.message).toContain("boom");
  });

  it("reports DOCKER_SCAN_FAILED with fallback message when error is missing", async () => {
    state.scanResult = { status: "failed", findings: [] };
    const result = await new DockerGuard({ projectRoot: "/x" }).run();
    expect(result.issues[0]?.code).toBe("DOCKER_SCAN_FAILED");
    expect(result.issues[0]?.message).toContain("Docker scan failed");
  });

  it("reports findings as issues", async () => {
    state.scanResult = {
      status: "passed",
      findings: [{ code: "IM-01", severity: "warning", title: "t", message: "m", tags: [] }],
    };
    const result = await new DockerGuard({ projectRoot: "/x" }).run();
    expect(result.issues).toHaveLength(1);
    expect(result.message).toContain("1 Docker issue");
  });
});
