import { beforeEach, describe, expect, test, vi } from "vitest";

const clack = vi.hoisted(() => ({
  outro: vi.fn(),
  log: { info: vi.fn(), message: vi.fn() },
  note: vi.fn(),
  text: vi.fn(),
  isCancel: vi.fn((v: unknown) => v === "CANCEL"),
}));

vi.mock("@clack/prompts", () => ({
  outro: clack.outro,
  log: clack.log,
  note: clack.note,
  text: clack.text,
  isCancel: clack.isCancel,
}));

import { promptSecurityUrl, showFixes, showOutro, showReport } from "../../../src/cli/interactive.js";
import type { AuditReport } from "../../../src/cli/types.js";

const base = (over: Partial<AuditReport> = {}): AuditReport => ({
  timestamp: 0,
  projectRoot: "/p",
  summary: { total: 0, critical: 0, error: 0, warning: 0, info: 0 },
  modules: {},
  ...over,
});

const manyIssues = Array.from({ length: 8 }, (_, i) => ({
  severity: "warning",
  title: `issue-${i}`,
  message: "m",
}));

describe("interactive branches", () => {
  beforeEach(() => {
    clack.outro.mockClear();
    clack.note.mockClear();
    clack.log.info.mockClear();
    clack.log.message.mockClear();
    clack.text.mockReset();
  });

  test("showOutro reports scanner failure and policy-blocked findings", () => {
    showOutro(base({ exitCode: 3 }));
    expect(clack.outro).toHaveBeenLastCalledWith(expect.stringContaining("scanner failed"));
    showOutro(base({ exitCode: 1, summary: { total: 1, critical: 0, error: 0, warning: 1, info: 0 } }));
    expect(clack.outro).toHaveBeenLastCalledWith(expect.stringContaining("block the selected audit policy"));
    showOutro(base({ exitCode: 1, summary: { total: 1, critical: 0, error: 1, warning: 0, info: 0 } }));
    expect(clack.outro).toHaveBeenLastCalledWith(expect.stringContaining("Failed"));
    showOutro(base({ exitCode: 0 }));
    expect(clack.outro).toHaveBeenLastCalledWith(expect.stringContaining("Passed"));
  });

  test("showReport prints scanner coverage and truncates unless verbose", () => {
    const r = base({
      modules: {
        scan: {
          issues: manyIssues,
          scan: {
            mode: "strict",
            exitCode: 0,
            scannerCoverage: [
              { scanner: "osv", status: "ok", scannedInputs: ["a"], skippedInputs: ["b"], diagnostics: ["d"] },
              { scanner: "docker", status: "ok", scannedInputs: [], skippedInputs: [], diagnostics: [] },
            ],
          },
        },
      },
    });
    showReport(r);
    expect(clack.note).toHaveBeenCalledWith(expect.stringContaining("Scan policy: strict"), "Scanner Coverage");
    const short = String(clack.log.message.mock.calls.at(-1)?.[0]);
    clack.log.message.mockClear();
    showReport(r, true);
    const full = String(clack.log.message.mock.calls.at(-1)?.[0]);
    expect(full.length).toBeGreaterThan(short.length);
    expect(full).toContain("issue-7");
  });

  test("showReport skips next steps when nothing is failing", () => {
    showReport(base());
    expect(clack.note).toHaveBeenCalledTimes(1);
  });

  test("showFixes tones every severity", () => {
    const issue = (severity: string, recommendation: string): Record<string, string> => ({
      severity,
      title: "t",
      message: "m",
      recommendation,
    });
    showFixes(
      base({
        modules: {
          a: { issues: [issue("critical", "r1"), issue("info", "r2"), issue("warning", "r3"), issue("error", "r4")] },
        },
      })
    );
    const [body] = clack.note.mock.calls.at(-1) as [string, string];
    for (const s of ["critical", "info", "warning", "error"]) expect(body).toContain(`[${s}]`);
    expect(body).not.toContain("×");
  });

  test("promptSecurityUrl validator accepts blank and http(s), rejects others", async () => {
    clack.text.mockResolvedValue("https://x.dev");
    await promptSecurityUrl();
    const opts = clack.text.mock.calls[0]?.[0] as { validate: (v: string | undefined) => string | undefined };
    expect(opts.validate("")).toBeUndefined();
    expect(opts.validate(undefined)).toBeUndefined();
    expect(opts.validate("https://x.dev")).toBeUndefined();
    expect(opts.validate("ftp://x")).toContain("http://");
  });
});
