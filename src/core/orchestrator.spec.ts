import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuditContext, AuditIssue, AuditResult } from "./types.js";
import { BaseGuard } from "./base-guard.js";

const state = vi.hoisted(() => ({ guards: [] as unknown[], throwOnCreate: undefined as Error | undefined }));
vi.mock("./guard-factory.js", () => ({
  GuardFactory: {
    create: () => ({
      createAllGuards: () => {
        if (state.throwOnCreate) throw state.throwOnCreate;
        return state.guards;
      },
    }),
  },
}));
const logs = vi.hoisted(() => [] as string[]);
vi.mock("../shared/logger.js", () => ({ log: (m: string) => logs.push(m), warn: vi.fn(), error: vi.fn() }));

import { AuditOrchestrator } from "./orchestrator.js";

const ctx: AuditContext = { projectRoot: "/tmp", timestamp: 1000, environment: "development", nodeVersion: "v", npmVersion: "1" };

class G extends BaseGuard {
  constructor(name: string, private readonly fn: (g: G) => Promise<AuditResult>) { super(name); }
  execute(): Promise<AuditResult> { return this.fn(this); }
  mk(sev: AuditIssue["severity"], tags: string[] = []): AuditIssue { return this.createIssue("C", sev, "t", "m", undefined, undefined, tags); }
  res(i: AuditIssue[]): AuditResult { return this.issues(i); }
}
class Rejecting extends BaseGuard {
  constructor() { super("rejecting-guard"); }
  execute(): Promise<AuditResult> { return Promise.resolve({} as AuditResult); }
  override run(): Promise<AuditResult> { return Promise.reject(new Error("kaboom")); }
}

beforeEach(() => { state.guards = []; state.throwOnCreate = undefined; logs.length = 0; });

describe("AuditOrchestrator", () => {
  it("aggregates, counts info, keeps success true with issues", async () => {
    state.guards = [
      new G("a-guard", async (g) => g.res([g.mk("warning"), g.mk("info"), g.mk("critical")])),
      new G("b-guard", async (g) => g.res([g.mk("error")])),
    ];
    const r = await AuditOrchestrator.create(ctx).execute();
    expect(r.success).toBe(true);
    expect(r.error).toBeUndefined();
    expect(r.summary).toMatchObject({ totalIssues: 4, critical: 1, errors: 1, warnings: 1, info: 1, timestamp: 1000 });
    expect(r.issues.map((i) => i.severity)).toEqual(["critical", "error", "warning", "info"]);
  });

  it("sorts by module using issue.module, tag fallback, then unknown", async () => {
    const raw = (m: string | undefined, tags: string[]): AuditIssue => ({ code: "c", severity: "warning", title: "t", message: "m", tags, ...(m ? { module: m } : {}) });
    state.guards = [new G("z", async () => ({ status: "warning", module: "z", issues: [raw("zeta", ["aaa"]), raw(undefined, ["beta"]), raw(undefined, []), raw("alpha", [])], message: "", timestamp: 0, duration: 0 }))];
    const asc = await AuditOrchestrator.create(ctx, { sortBy: "module", sortOrder: "asc" }).execute();
    expect(asc.issues.map((i) => i.module ?? i.tags[0] ?? "unknown")).toEqual(["alpha", "beta", "unknown", "zeta"]);
    const desc = await AuditOrchestrator.create(ctx, { sortBy: "module", sortOrder: "desc" }).execute();
    expect(desc.issues[0]?.module).toBe("zeta");
  });

  it("getIssuesByModule groups by module with fallbacks", () => {
    const o = AuditOrchestrator.create(ctx);
    const i = (module: string | undefined, tags: string[]): AuditIssue => ({ code: "c", severity: "info", title: "", message: "", tags, ...(module ? { module } : {}) });
    const m = o.getIssuesByModule([i("x", ["t"]), i("x", []), i(undefined, ["t"]), i(undefined, [])]);
    expect([...m.keys()]).toEqual(["x", "t", "unknown"]);
    expect(m.get("x")).toHaveLength(2);
    expect(o.getIssuesBySeverity([i("x", [])], "info")).toHaveLength(1);
  });

  it("names rejected guards by module name", async () => {
    state.guards = [new Rejecting()];
    const r = await AuditOrchestrator.create(ctx).execute();
    expect(r.results[0]?.module).toBe("rejecting-guard");
    expect(r.issues[0]?.code).toBe("GUARD_REJECTED");
    expect(r.issues[0]?.message).toBe("kaboom");
    expect(r.success).toBe(true);
  });

  it("respects parallel:false (sequential) and survives rejections", async () => {
    const order: string[] = [];
    const slow = new G("slow", async (g) => { order.push("slow-start"); await new Promise((x) => setTimeout(x, 30)); order.push("slow-end"); return g.res([]); });
    const fast = new G("fast", async (g) => { order.push("fast"); return g.res([]); });
    state.guards = [slow, new Rejecting(), fast];
    const seq = await AuditOrchestrator.create(ctx, { parallel: false }).execute();
    expect(order).toEqual(["slow-start", "slow-end", "fast"]);
    expect(seq.results.map((x) => x.module)).toEqual(["slow", "rejecting-guard", "fast"]);

    order.length = 0;
    state.guards = [slow, fast];
    await AuditOrchestrator.create(ctx).execute();
    expect(order).toEqual(["slow-start", "fast", "slow-end"]);
  });

  it("reports orchestration crashes via success:false and error", async () => {
    state.throwOnCreate = new Error("factory broke");
    const r = await AuditOrchestrator.create(ctx).execute();
    expect(r.success).toBe(false);
    expect(r.error).toBe("factory broke");
    expect(r.results).toEqual([]);
    expect(r.summary.errors).toBe(1);

    state.throwOnCreate = "weird" as unknown as Error;
    expect((await AuditOrchestrator.create(ctx).execute()).error).toBe("weird");
  });

  it("printSummary logs counts including info", () => {
    const o = AuditOrchestrator.create(ctx);
    o.printSummary({ success: true, results: [], issues: [], summary: { totalIssues: 0, critical: 0, errors: 0, warnings: 0, info: 2, duration: -5, timestamp: 0 } });
    const out = logs.join("\n");
    expect(out).toContain("Info: 2");
    expect(out).toContain("0ms");
    expect(out).toContain("All audits passed");
    logs.length = 0;
    o.printSummary({ success: true, results: [], issues: [], summary: { totalIssues: 3, critical: 0, errors: 0, warnings: 3, duration: 1500, timestamp: 0 } });
    expect(logs.join("\n")).toContain("1.50s");
    expect(logs.join("\n")).toContain("Found 3 issue(s)");
  });
});
