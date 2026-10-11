import { beforeEach, describe, expect, test, vi } from "vitest";

const clack = vi.hoisted(() => {
  const spinner = { start: vi.fn(), stop: vi.fn(), error: vi.fn() };
  return {
    spinner,
    intro: vi.fn(),
    outro: vi.fn(),
    cancel: vi.fn(),
    log: { info: vi.fn(), message: vi.fn() },
    note: vi.fn(),
    text: vi.fn(),
    select: vi.fn(),
    multiselect: vi.fn(),
    isCancel: vi.fn((v: unknown) => v === "CANCEL"),
  };
});

vi.mock("@clack/prompts", () => ({
  intro: clack.intro,
  outro: clack.outro,
  cancel: clack.cancel,
  log: clack.log,
  note: clack.note,
  text: clack.text,
  select: clack.select,
  multiselect: clack.multiselect,
  isCancel: clack.isCancel,
  spinner: () => clack.spinner,
}));

import {
  promptAfterReport,
  promptCategories,
  showAssistantPrompt,
  showFixes,
  promptScanChoices,
  promptSecurityUrl,
  showReport,
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
  summary: { total: 0, critical: 0, error: 0, warning: 0, info: 0, ...over },
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
    expect(summarizeReport(report({ total: 2, error: 1, warning: 1 })).failed).toBe(true);
    const ok = summarizeReport(report({ total: 1, info: 1 }));
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

  test("promptCategories maps ids to a module filter", async () => {
    clack.multiselect.mockResolvedValue(["security", "performance"]);
    const picked = await promptCategories();
    expect(picked?.modules).toEqual(["security-guard", "image-guard", "memory-guard", "async-guard"]);
    clack.multiselect.mockResolvedValue(["full"]);
    expect((await promptCategories())?.modules).toBeUndefined();
    clack.multiselect.mockResolvedValue("CANCEL");
    expect(await promptCategories()).toBeNull();
  });

  test("promptSecurityUrl handles blank, value and cancel", async () => {
    clack.text.mockResolvedValue("");
    expect(await promptSecurityUrl()).toBeUndefined();
    clack.text.mockResolvedValue("http://localhost:3000");
    expect(await promptSecurityUrl()).toBe("http://localhost:3000");
    clack.text.mockResolvedValue("CANCEL");
    expect(await promptSecurityUrl()).toBeNull();
  });

  test("showReport prints overview, issues and next steps", () => {
    const r = report({ total: 1, error: 1 });
    r.modules = {
      "image-guard": {
        issues: [{ severity: "error", title: "big.png", message: "900 KB", recommendation: "compress" }],
      },
      "config-guard": { issues: [] },
    };
    showReport(r);
    expect(clack.note).toHaveBeenCalledWith(expect.stringContaining("image-guard"), "Results");
    expect(clack.log.message).toHaveBeenCalledTimes(1);
    expect(clack.note).toHaveBeenCalledWith(expect.stringContaining("Shrink oversized images"), "Next steps");
  });

  test("promptAfterReport offers fixes and the AI hand-off only when there are issues", async () => {
    clack.select.mockResolvedValue("done");
    const values = (): string[] => clack.select.mock.calls.at(-1)?.[0].options.map((o: { value: string }) => o.value);
    await promptAfterReport(true);
    expect(values()).toEqual(["fixes", "all", "ai", "html", "done"]);
    await promptAfterReport(false);
    expect(values()).toEqual(["html", "done"]);
  });

  test("showFixes prints one grouped list, or says there are no recommendations", () => {
    const withFixes = {
      ...report({ total: 3, error: 1, warning: 2 }),
      modules: {
        a: {
          issues: [
            { severity: "warning", title: "t", message: "m", recommendation: "Add a license" },
            { severity: "error", title: "t", message: "m", recommendation: "Add a license" },
            { severity: "warning", title: "t", message: "m" },
          ],
        },
      },
    };
    showFixes(withFixes);
    const [body, title] = clack.note.mock.calls.at(-1) as [string, string];
    expect(title).toBe("Recommended fixes");
    expect(body).toContain("Add a license");
    expect(body).toContain("×2");
    expect(body).toContain("[error]");

    showFixes(report());
    expect(clack.log.info).toHaveBeenCalledWith(expect.stringContaining("No automatic recommendations"));
  });

  test("showAssistantPrompt prints a paste-ready prompt", () => {
    showAssistantPrompt({
      ...report({ total: 1, error: 1 }),
      modules: { a: { issues: [{ severity: "error", title: "Bad", message: "broken", location: { file: "x.ts", line: 3 } }] } },
    });
    const [body, title] = clack.note.mock.calls.at(-1) as [string, string];
    expect(title).toBe("Paste this into your AI assistant");
    expect(body).toContain("[error] Bad (x.ts:3) - broken");
  });

  test("promptAfterReport returns the choice, done on cancel", async () => {
    clack.select.mockResolvedValue("html");
    expect(await promptAfterReport(true)).toBe("html");
    clack.select.mockResolvedValue("CANCEL");
    expect(await promptAfterReport(false)).toBe("done");
  });
});
