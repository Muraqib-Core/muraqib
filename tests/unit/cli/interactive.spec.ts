import { beforeEach, describe, expect, test, vi } from "vitest";

const clack = vi.hoisted(() => {
  const spinner = { start: vi.fn(), stop: vi.fn(), error: vi.fn() };
  return {
    spinner,
    intro: vi.fn(),
    outro: vi.fn(),
    cancel: vi.fn(),
    log: { info: vi.fn() },
    multiselect: vi.fn(),
    isCancel: vi.fn((v: unknown) => v === "CANCEL"),
  };
});

vi.mock("@clack/prompts", () => ({
  intro: clack.intro,
  outro: clack.outro,
  cancel: clack.cancel,
  log: clack.log,
  multiselect: clack.multiselect,
  isCancel: clack.isCancel,
  spinner: () => clack.spinner,
}));

import {
  promptScanChoices,
  shouldUseInteractive,
  showCancelled,
  showIntro,
  showOutro,
  summarizeReport,
  withSpinner,
  type InteractiveContext,
} from "../../../src/cli/interactive.js";
import type { AuditReport } from "../../../src/cli/types.js";

const tty: InteractiveContext = {
  flag: undefined,
  format: "text",
  hasOutputFile: false,
  stdoutIsTTY: true,
  stdinIsTTY: true,
  env: {},
};

const report = (over: Partial<AuditReport["summary"]> = {}): AuditReport => ({
  timestamp: 0,
  projectRoot: "/p",
  summary: { total: 0, critical: 0, high: 0, medium: 0, low: 0, ...over },
  modules: {},
});

describe("shouldUseInteractive", () => {
  test("is on for a plain text run in a terminal", () => {
    expect(shouldUseInteractive(tty)).toBe(true);
  });

  test.each([
    ["--no-interactive", { flag: false }],
    ["machine format", { format: "json" }],
    ["output file", { hasOutputFile: true }],
    ["piped stdout", { stdoutIsTTY: false }],
    ["no stdin tty", { stdinIsTTY: false }],
    ["CI environment", { env: { CI: "true" } }],
  ])("is off for %s", (_name, over) => {
    expect(shouldUseInteractive({ ...tty, ...over })).toBe(false);
  });

  test("CI=false or empty does not disable it", () => {
    expect(shouldUseInteractive({ ...tty, env: { CI: "false" } })).toBe(true);
    expect(shouldUseInteractive({ ...tty, env: { CI: "" } })).toBe(true);
  });
});

describe("prompts and rendering", () => {
  beforeEach(() => {
    Object.values(clack).forEach((v) => {
      if (typeof v === "function" && "mockClear" in v) v.mockClear();
    });
    clack.spinner.start.mockClear();
    clack.spinner.stop.mockClear();
  });

  test("promptScanChoices maps the selection", async () => {
    clack.multiselect.mockResolvedValue(["osv", "ai"]);
    expect(await promptScanChoices()).toEqual({ osv: true, docker: false, aiAdvisory: true });
  });

  test("promptScanChoices returns null when cancelled", async () => {
    clack.multiselect.mockResolvedValue("CANCEL");
    expect(await promptScanChoices()).toBeNull();
  });

  test("summarizeReport flags critical/error as failed", () => {
    expect(summarizeReport(report({ total: 2, high: 1, medium: 1 })).failed).toBe(true);
    const ok = summarizeReport(report({ total: 1, low: 1 }));
    expect(ok.failed).toBe(false);
    expect(ok.text).toContain("1 info");
  });

  test("withSpinner stops on success and on failure", async () => {
    await expect(withSpinner("x", async () => 7)).resolves.toBe(7);
    expect(clack.spinner.stop).toHaveBeenLastCalledWith("Audit finished");
    await expect(
      withSpinner("x", async () => {
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");
    expect(clack.spinner.error).toHaveBeenLastCalledWith("Audit failed");
  });

  test("intro/outro/cancel messages", () => {
    showIntro("/proj");
    expect(clack.intro).toHaveBeenCalled();
    expect(clack.log.info).toHaveBeenCalledWith("Project: /proj");
    showOutro(report({ total: 1, critical: 1 }));
    expect(clack.outro).toHaveBeenLastCalledWith(expect.stringContaining("Failed"));
    showOutro(report());
    expect(clack.outro).toHaveBeenLastCalledWith(expect.stringContaining("Passed"));
    showCancelled();
    expect(clack.cancel).toHaveBeenCalled();
  });
});
