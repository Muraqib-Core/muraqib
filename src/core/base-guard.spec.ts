import { describe, it, expect, vi, afterEach } from "vitest";
import { BaseGuard } from "./base-guard.js";
import type { AuditIssue, AuditResult, GuardFinding } from "./types.js";

type Body = (g: TestGuard) => Promise<AuditResult>;

class TestGuard extends BaseGuard {
  constructor(private readonly body: Body = async (g) => g.exposeOk("fine")) {
    super("test-guard");
  }
  async execute(): Promise<AuditResult> {
    return this.body(this);
  }
  exposeOk(m: string): AuditResult { return this.ok(m); }
  exposeIssues(i: AuditIssue[], m?: string): AuditResult { return this.issues(i, m); }
  exposeIssue(sev: AuditIssue["severity"]): AuditIssue { return this.createIssue("X", sev, "t", "m"); }
  exposeResult(i: AuditIssue[]): AuditResult { return this.createResult("warning", i, "x"); }
  fromFindings(f: GuardFinding[]): AuditIssue[] { return this.issuesFromFindings(f, "Title", "Fix it"); }
  bytes(n: number): string { return this.formatBytes(n); }
  dur(n: number): string { return this.formatDuration(n); }
  json<T>(s: string, f: T): T { return this.parseJSON(s, f); }
}

afterEach(() => vi.useRealTimers());

describe("BaseGuard", () => {
  it("exposes module name", () => {
    const g = new TestGuard();
    expect(g.getModule()).toBe("test-guard");
    expect(g.name).toBe("test-guard");
  });

  it("createIssue stamps module", () => {
    expect(new TestGuard().exposeIssue("info").module).toBe("test-guard");
  });

  it("createResult stamps module on issues lacking it without mutating input", () => {
    const raw: AuditIssue = { code: "A", severity: "warning", title: "t", message: "m", tags: [] };
    const res = new TestGuard().exposeResult([raw]);
    expect(res.issues[0]?.module).toBe("test-guard");
    expect(raw.module).toBeUndefined();
  });

  it("keeps an existing issue module", () => {
    const raw: AuditIssue = { code: "A", severity: "warning", title: "t", message: "m", tags: [], module: "scan" };
    expect(new TestGuard().exposeResult([raw]).issues[0]?.module).toBe("scan");
  });

  it("error results carry the module and GUARD_ERROR", async () => {
    const res = await new TestGuard(async () => { throw new Error("boom"); }).run();
    expect(res.status).toBe("error");
    expect(res.issues[0]?.code).toBe("GUARD_ERROR");
    expect(res.issues[0]?.module).toBe("test-guard");
    expect(res.message).toBe("boom");
  });

  it("stringifies non-Error throws", async () => {
    const res = await new TestGuard(async () => { throw "str"; }).run();
    expect(res.message).toBe("str");
  });

  it("direct execute() yields a sane (non-epoch) duration", async () => {
    const res = await new TestGuard().execute();
    expect(res.duration).toBeGreaterThanOrEqual(0);
    expect(res.duration).toBeLessThan(5000);
  });

  it("overlapping run() calls report their own durations", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const g = new TestGuard(async (self) => {
      await new Promise((r) => setTimeout(r, 100));
      return self.exposeOk("a");
    });
    const first = g.run();
    await vi.advanceTimersByTimeAsync(60);
    const second = g.run();
    await vi.advanceTimersByTimeAsync(200);
    const [a, b] = await Promise.all([first, second]);
    expect(a.duration).toBe(100);
    expect(b.duration).toBe(100);
  });

  describe("issues()", () => {
    const g = new TestGuard();
    it("empty => ok", () => {
      const r = g.exposeIssues([]);
      expect(r.status).toBe("ok");
      expect(r.message).toBe("No issues found");
    });
    it("info only => ok with count message", () => {
      const r = g.exposeIssues([g.exposeIssue("info")]);
      expect(r.status).toBe("ok");
      expect(r.message).toBe("Found 1 issue(s)");
    });
    it("warning => warning", () => {
      expect(g.exposeIssues([g.exposeIssue("warning")]).status).toBe("warning");
    });
    it("error => issues, critical => error", () => {
      expect(g.exposeIssues([g.exposeIssue("error")]).status).toBe("issues");
      expect(g.exposeIssues([g.exposeIssue("error"), g.exposeIssue("critical")]).status).toBe("error");
    });
    it("custom message wins, including empty string", () => {
      expect(g.exposeIssues([g.exposeIssue("warning")], "custom").message).toBe("custom");
      expect(g.exposeIssues([g.exposeIssue("warning")], "").message).toBe("");
    });
  });

  describe("formatBytes", () => {
    const g = new TestGuard();
    it.each([
      [0, "0 B"],
      [0.5, "0.50 B"],
      [512, "512.00 B"],
      [1536, "1.50 KB"],
      [-1536, "-1.50 KB"],
      [1024 ** 4, "1.00 TB"],
      [1024 ** 5 * 2, "2.00 PB"],
      [1024 ** 6, "1024.00 PB"],
      [Number.NaN, "N/A"],
      [Number.POSITIVE_INFINITY, "N/A"],
    ])("%s -> %s", (n, out) => expect(g.bytes(n)).toBe(out));
  });

  describe("formatDuration", () => {
    const g = new TestGuard();
    it.each([
      [500, "500ms"],
      [1250, "1.25s"],
      [-5, "0ms"],
      [Number.NaN, "0ms"],
      [Number.POSITIVE_INFINITY, "0ms"],
    ])("%s -> %s", (n, out) => expect(g.dur(n)).toBe(out));
  });

  it("parseJSON parses or falls back", () => {
    const g = new TestGuard();
    expect(g.json<{ a: number }>('{"a":1}', { a: 0 })).toEqual({ a: 1 });
    expect(g.json("{bad", 7)).toBe(7);
  });

  it("issuesFromFindings maps findings in order and includes a location only when a file is set", () => {
    const issues = new TestGuard().fromFindings([
      { code: "A", severity: "error", message: "a", file: "x.ts", line: 3 },
      { code: "B", severity: "info", message: "b", file: "y.ts" },
      { code: "C", severity: "warning", message: "c" },
    ]);
    expect(issues.map((i) => i.code)).toEqual(["A", "B", "C"]);
    expect(issues[0]).toMatchObject({ title: "Title", recommendation: "Fix it", module: "test-guard", location: { file: "x.ts", line: 3 } });
    expect(issues[1]?.location).toEqual({ file: "y.ts" });
    expect(issues[2]?.location).toBeUndefined();
  });
});
