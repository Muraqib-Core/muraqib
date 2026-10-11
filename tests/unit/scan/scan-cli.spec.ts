import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const m = vi.hoisted(() => ({
  imageScan: vi.fn(),
  runtimeScan: vi.fn(),
  run: vi.fn(),
  select: vi.fn(),
  isCancel: vi.fn(() => false),
  spinnerStop: vi.fn(),
  outro: vi.fn(),
  cancel: vi.fn(),
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
vi.mock("../../../src/scan/core/runner/audit-runner.js", () => ({
  AuditRunner: class {
    run = m.run;
  },
}));
vi.mock("../../../src/scan/core/context/project-context.js", () => ({
  createProjectContext: vi.fn(() => ({ projectPath: "/p" })),
}));
vi.mock("@clack/prompts", () => ({
  intro: vi.fn(),
  outro: m.outro,
  cancel: m.cancel,
  note: vi.fn(),
  select: m.select,
  isCancel: m.isCancel,
  log: { info: vi.fn() },
  spinner: () => ({ start: vi.fn(), stop: m.spinnerStop }),
}));

import { main } from "../../../src/scan/cli.js";

const finding = (level: string) => ({ level, category: "security", message: "m", code: "c", severity: "error", title: "t", source: "s" });
const report = (over: Record<string, unknown> = {}) => ({
  findings: [],
  totalParsedLines: 0,
  engine: "custom",
  mode: "build",
  scannedEnvFiles: [],
  aiAdvisory: null,
  scannerCoverage: [],
  hasBlockingIssues: false,
  exitCode: 0,
  ...over,
});

class ExitSignal extends Error {
  constructor(readonly code?: number) {
    super("exit");
  }
}

/** Run main(); a mocked process.exit aborts the flow like the real one. */
async function run(argv: string[]): Promise<void> {
  try {
    await main(argv);
  } catch (err) {
    if (!(err instanceof ExitSignal)) throw err;
  }
}

let logs: string[];
let exitSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  logs = [];
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
    logs.push(a.join(" "));
  });
  exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new ExitSignal(code);
  }) as never);
  process.exitCode = undefined;
});

afterEach(() => {
  vi.restoreAllMocks();
  Object.values(m).forEach((f) => f.mockReset());
  m.isCancel.mockReturnValue(false);
  process.exitCode = undefined;
});

describe("scan CLI validation", () => {
  test("rejects unknown command, env and engine", async () => {
    await expect(main(["bogus"])).rejects.toThrow("Unknown command");
    await expect(main(["audit", "-e", "staging"])).rejects.toThrow("Invalid environment mode");
    await expect(main(["audit", "--engine", "joi"])).rejects.toThrow("Invalid validation engine");
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

describe("scan CLI audit", () => {
  test("json success path exits with the report code", async () => {
    m.run.mockResolvedValue(report());
    await run(["audit", "--json", "-e", "prod", "--engine", "zod", "--ai", "--docker-native"]);
    expect(m.run).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ mode: "prod", engine: "zod", enableAi: true, dockerNative: true }));
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  test("json failure path reports AUDIT_EXECUTION_FAILED with exit 3", async () => {
    m.run.mockRejectedValue(new Error("boom"));
    await run(["--json"]);
    expect(JSON.parse(logs.join("\n")).error.code).toBe("AUDIT_EXECUTION_FAILED");
    expect(exitSpy).toHaveBeenCalledWith(3);
  });

  test("interactive failure path (Error and non-Error)", async () => {
    m.select.mockResolvedValue("build");
    m.run.mockRejectedValue("plain");
    await run(["audit"]);
    expect(m.spinnerStop).toHaveBeenCalledWith("Audit execution failed!");
    expect(m.outro).toHaveBeenCalledWith(expect.stringContaining("plain"));
    expect(exitSpy).toHaveBeenCalledWith(3);
  });

  test("prompts for the mode and exits 0 on a clean report", async () => {
    m.select.mockResolvedValue("prod");
    m.run.mockResolvedValue(report());
    await run([]);
    expect(m.run).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ mode: "prod" }));
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  test("cancelled prompt exits 0", async () => {
    m.select.mockResolvedValue(Symbol("cancel"));
    m.isCancel.mockReturnValue(true);
    m.run.mockResolvedValue(report());
    await run([]);
    expect(m.cancel).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  test("blocking report exits 1 and prints the resolve tip", async () => {
    const dep = { ...finding("high"), dependencyProblem: { package: "p", installedVersion: "1", advisoryCount: 1 } };
    m.run.mockResolvedValue(report({ exitCode: 1, findings: [dep] }));
    await run(["-e", "build"]);
    expect(logs.join("\n")).toContain("muraqib resolve");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  test("scanner failure exits 3", async () => {
    m.run.mockResolvedValue(report({ exitCode: 3 }));
    await run(["-e", "build"]);
    expect(exitSpy).toHaveBeenCalledWith(3);
  });
});
