import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const m = vi.hoisted(() => ({
  imageScan: vi.fn(),
  runtimeScan: vi.fn(),
  resolve: vi.fn(),
}));

vi.mock("../../../src/scan/scanners/docker/image-engine.js", () => ({
  DockerImageScanner: class {
    scan = m.imageScan;
  },
}));
vi.mock("../../../src/scan/scanners/docker/runtime-engine.js", () => ({
  DockerRuntimeScanner: class {
    scan = m.runtimeScan;
  },
}));
vi.mock("../../../src/scan/cli/resolve-workflow.js", () => ({ runResolveWorkflow: m.resolve }));
vi.mock("../../../src/scan/core/context/project-context.js", () => ({
  createProjectContext: vi.fn(() => ({ projectPath: "/p" })),
}));

import { main } from "../../../src/scan/cli.js";

const finding = (level: string) => ({ level, category: "security", message: "m", code: "c", severity: "error", title: "t", source: "s" });

let logs: string[];

beforeEach(() => {
  logs = [];
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
    logs.push(a.join(" "));
  });
  process.exitCode = undefined;
});

afterEach(() => {
  vi.restoreAllMocks();
  Object.values(m).forEach((f) => f.mockReset());
  process.exitCode = undefined;
});

describe("scan CLI validation", () => {
  test("rejects unknown and missing commands", async () => {
    await expect(main(["bogus"])).rejects.toThrow("Unknown command");
    await expect(main([])).rejects.toThrow("Unknown command");
    // `audit` is owned by the primary CLI, not the scan layer.
    await expect(main(["audit"])).rejects.toThrow("Unknown command");
  });

  test("image and runtime require their target flag", async () => {
    await expect(main(["image"])).rejects.toThrow("--image");
    await expect(main(["runtime"])).rejects.toThrow("--container");
  });
});

describe("scan CLI image/runtime", () => {
  test("image: passed, text output with diagnostics", async () => {
    m.imageScan.mockResolvedValue({ scanner: "image", status: "success", findings: [], diagnostics: ["note"] });
    await main(["image", "--image", "app:1"]);
    expect(process.exitCode).toBe(0);
    expect(logs.join("\n")).toContain("image: success");
    expect(logs.join("\n")).toContain("note");
  });

  test("image: high finding fails with exit 1 (json)", async () => {
    m.imageScan.mockResolvedValue({ scanner: "image", status: "success", findings: [finding("high")] });
    await main(["image", "--image", "app:1", "--json"]);
    expect(process.exitCode).toBe(1);
    expect(JSON.parse(logs.join("\n")).status).toBe("failed");
  });

  test("runtime: scanner error exits 3 (json) and defaults empty arrays", async () => {
    m.runtimeScan.mockResolvedValue({ scanner: "runtime", status: "failed", findings: [] });
    await main(["runtime", "--container", "c1", "--json"]);
    expect(process.exitCode).toBe(3);
    const out = JSON.parse(logs.join("\n"));
    expect(out.status).toBe("error");
    expect(out.scannerCoverage[0].scannedInputs).toEqual([]);
  });

  test("runtime: passed json", async () => {
    m.runtimeScan.mockResolvedValue({ scanner: "runtime", status: "success", findings: [finding("low")], scannedInputs: ["c1"] });
    await main(["runtime", "--container", "c1", "--json"]);
    expect(JSON.parse(logs.join("\n")).status).toBe("passed");
  });
});

describe("scan CLI resolve and help", () => {
  test("resolve runs the resolution workflow in the current project", async () => {
    await main(["resolve", "--osv"]);
    expect(m.resolve).toHaveBeenCalledWith({ projectPath: "/p" });
  });

  test("--help prints usage without running anything", async () => {
    await main(["--help"]);
    expect(logs.join("\n")).toContain("muraqib resolve");
    expect(m.resolve).not.toHaveBeenCalled();
  });
});
