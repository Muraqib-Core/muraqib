import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { isSilentMode, setSilentMode } from "../../../src/shared/logger.js";
import { isWithinSchedule } from "../../../src/utils/schedule-validator.js";
import { loadEnv } from "../../../src/env/loaders.js";
import { createEnvWithPresets } from "../../../src/env/presets.js";
import { AuditOrchestrator } from "../../../src/core/orchestrator.js";
import { NetworkLatencyGuard } from "../../../src/core/performance/network-latency-advisor.js";
import { createMuraqibEnv } from "../../../src/core/validate.js";
import { BaseGuard } from "../../../src/core/base-guard.js";
import type { AuditResult } from "../../../src/core/types.js";

const get = vi.hoisted(() => vi.fn());
vi.mock("axios", () => ({ default: { get } }));

class ChattyGuard extends BaseGuard {
  constructor() {
    super("chatty");
  }
  async execute(): Promise<AuditResult> {
    this.log("info");
    this.warn("warn");
    this.error("error");
    return this.ok("done");
  }
}

let logSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  setSilentMode(false);
  vi.restoreAllMocks();
  get.mockReset();
});

const expectNoOutput = (): void => {
  expect(logSpy).not.toHaveBeenCalled();
  expect(warnSpy).not.toHaveBeenCalled();
  expect(errorSpy).not.toHaveBeenCalled();
};

describe("silent mode suppresses module output", () => {
  it("reports the current state", () => {
    expect(isSilentMode()).toBe(false);
    setSilentMode(true);
    expect(isSilentMode()).toBe(true);
  });

  it("BaseGuard log/warn/error", async () => {
    setSilentMode(true);
    await new ChattyGuard().run();
    expectNoOutput();
  });

  it("BaseGuard logs when not silent", async () => {
    await new ChattyGuard().run();
    expect(logSpy).toHaveBeenCalledWith("[chatty] info");
    expect(warnSpy).toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
  });

  it("invalid cron schedule warning", () => {
    setSilentMode(true);
    expect(isWithinSchedule("not a cron")).toBe(true);
    expectNoOutput();
  });

  it("invalid cron schedule warns when not silent", () => {
    expect(isWithinSchedule("not a cron")).toBe(true);
    expect(warnSpy).toHaveBeenCalled();
  });

  it("env loader and presets", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "muraqib-silent-"));
    const saved = process.env.SILENT_X;
    try {
      fs.writeFileSync(path.join(dir, ".env"), "SILENT_X=1\n");
      setSilentMode(true);
      loadEnv({ cwd: dir, verbose: true, preserveProcessEnv: true });
      createEnvWithPresets({}, { runtimeEnv: {}, presets: ["__unknown__"] } as never);
      expectNoOutput();
    } finally {
      if (saved === undefined) delete process.env.SILENT_X;
      else process.env.SILENT_X = saved;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("security exception output of createMuraqibEnv still throws", async () => {
    setSilentMode(true);
    await expect(createMuraqibEnv({ NEXT_PUBLIC_SECRET: "x" })).rejects.toThrow(/client-side prefixes/);
    expectNoOutput();
  });

  it("orchestrator summary", async () => {
    setSilentMode(true);
    const orchestrator = AuditOrchestrator.create({
      projectRoot: process.cwd(),
      timestamp: Date.now(),
      environment: "development",
      nodeVersion: process.version,
      npmVersion: "9.0.0",
      gitBranch: "main",
      gitCommit: "abc",
    });
    const result = await orchestrator.execute();
    orchestrator.printSummary(result);
    expectNoOutput();
  });

  it("network latency audit (success and failure)", async () => {
    setSilentMode(true);
    get.mockResolvedValueOnce({ headers: { "content-length": "40960" }, data: "x" });
    await new NetworkLatencyGuard({ targetUrl: "http://x" }).run();
    get.mockRejectedValueOnce(new Error("down"));
    await new NetworkLatencyGuard({ targetUrl: "http://x" }).run();
    expectNoOutput();
  });
});
