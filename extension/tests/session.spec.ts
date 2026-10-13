import * as path from "node:path";
import { describe, expect, it } from "vitest";
import type { DiagnosticSpec } from "../src/core/diagnostics.js";
import { AuditSession, type AuditEngine, type SessionPorts } from "../src/core/session.js";
import type { StatusState } from "../src/core/status.js";
import type { AgentAuditOptions, AgentReport } from "../src/core/types.js";
import { makeIssue, makeReport } from "./fixtures.js";

interface Harness {
  session: AuditSession;
  states: StatusState[];
  applied: Array<Map<string, DiagnosticSpec[]>>;
  calls: AgentAuditOptions[];
}

function setup(run: (options: AgentAuditOptions) => Promise<AgentReport>, root: string | null = "/work/project"): Harness {
  const states: StatusState[] = [];
  const applied: Array<Map<string, DiagnosticSpec[]>> = [];
  const calls: AgentAuditOptions[] = [];
  const engine: AuditEngine = {
    runAudit: (options) => {
      calls.push(options);
      return run(options);
    },
    getDocsHtml: async () => "<html></html>",
  };
  const ports: SessionPorts = {
    engine,
    workspaceRoot: () => root ?? undefined,
    readOptions: (r) => ({ projectRoot: r, modules: ["security"] }),
    onState: (s) => states.push(s),
    applyDiagnostics: (m) => applied.push(m),
  };
  return { session: new AuditSession(ports), states, applied, calls };
}

describe("AuditSession", () => {
  it("runs an audit, stores the report and publishes diagnostics", async () => {
    const report = makeReport({ issues: [makeIssue({ id: "x", file: path.join("src", "a.ts") })] });
    const h = setup(async () => report);
    const outcome = await h.session.run();
    expect(outcome).toEqual({ kind: "done", report });
    expect(h.calls).toEqual([{ projectRoot: "/work/project", modules: ["security"] }]);
    expect(h.states.map((s) => s.kind)).toEqual(["running", "done"]);
    expect(h.session.lastReport).toBe(report);
    expect(h.session.lastWorkspaceRoot).toBe("/work/project");
    expect(h.session.reportedFiles.has(path.join("src", "a.ts"))).toBe(true);
    expect(h.applied).toHaveLength(1);
    expect(h.applied[0]?.size).toBe(1);
    expect(h.session.running).toBe(false);
  });

  it("reports no-workspace without calling the engine", async () => {
    const h = setup(async () => makeReport(), null);
    expect(await h.session.run()).toEqual({ kind: "no-workspace" });
    expect(h.calls).toHaveLength(0);
    expect(h.states).toHaveLength(0);
    expect(h.session.reportedFiles.size).toBe(0);
  });

  it("treats ok:false as data: keeps the report, shows its issues, does not throw", async () => {
    const report = makeReport({ ok: false, verdict: "fail", exitCode: 3, error: "scanner crashed" });
    const h = setup(async () => report);
    const outcome = await h.session.run();
    expect(outcome).toEqual({ kind: "failed", message: "scanner crashed", report });
    expect(h.session.lastReport).toBe(report);
    expect(h.applied).toHaveLength(1);
    expect(h.states.at(-1)).toEqual({ kind: "done", report });
  });

  it("explains an ok:false report that has no error text", async () => {
    const h = setup(async () => makeReport({ ok: false }));
    const outcome = await h.session.run();
    expect(outcome.kind === "failed" && outcome.message).toContain("did not complete reliably");
  });

  it("converts a thrown engine error into a failed state", async () => {
    const h = setup(async () => {
      throw new Error("engine missing");
    });
    expect(await h.session.run()).toEqual({ kind: "failed", message: "engine missing" });
    expect(h.states.at(-1)).toEqual({ kind: "failed", message: "engine missing" });
    expect(h.session.lastReport).toBeUndefined();
    expect(h.session.running).toBe(false);
  });

  it("stringifies non-Error rejections", async () => {
    const h = setup(() => Promise.reject("plain"));
    expect(await h.session.run()).toEqual({ kind: "failed", message: "plain" });
  });

  it("does not touch process.exitCode for findings or failures", async () => {
    const before = process.exitCode;
    await setup(async () => makeReport({ exitCode: 1 })).session.run();
    await setup(async () => makeReport({ ok: false, exitCode: 3 })).session.run();
    expect(process.exitCode).toBe(before);
  });

  it("shares one in-flight audit between concurrent callers and allows a later run", async () => {
    let release: (r: AgentReport) => void = () => undefined;
    const h = setup(() => new Promise<AgentReport>((resolve) => (release = resolve)));
    const first = h.session.run();
    const second = h.session.run();
    expect(h.session.running).toBe(true);
    expect(h.calls).toHaveLength(1);
    release(makeReport());
    expect(await first).toBe(await second);
    expect(h.session.running).toBe(false);
    void h.session.run();
    expect(h.calls).toHaveLength(2);
  });
});
