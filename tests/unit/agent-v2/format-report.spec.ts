import { describe, expect, test } from "vitest";
import { formatPlanJson, formatPlanText } from "../../../src/agent-v2/format.js";
import { formatFixReport } from "../../../src/agent-v2/fix/report.js";
import type { FixSessionResult } from "../../../src/agent-v2/fix/session.js";
import type { AgentPlan, PlanStep } from "../../../src/agent-v2/types.js";
import { fixOf } from "./fix/helpers.js";

function plan(over: Partial<AgentPlan> = {}): AgentPlan {
  return {
    schemaVersion: "1.0",
    projectRoot: "/p",
    verdict: "fail",
    ok: true,
    summary: { total: 0, autoFixable: 0, manual: 0, byFixClass: { "floating-promise": 0, "hardcoded-secret": 0, "env-documentation": 0, manual: 0 } },
    steps: [],
    ...over,
  };
}
function step(over: Partial<PlanStep> = {}): PlanStep {
  return { rank: 1, issueId: "i", module: "m", code: "C", severity: "warning", title: "T", fixClass: "manual", autoFixable: false, reasons: ["r1", "r2"], ...over };
}

describe("formatPlanText", () => {
  test("failed plan with and without error", () => {
    expect(formatPlanText(plan({ ok: false, error: "boom" }))).toBe("Muraqib agent plan failed: boom\n");
    expect(formatPlanText(plan({ ok: false }))).toContain("audit could not run");
  });

  test("empty plan says nothing to fix", () => {
    expect(formatPlanText(plan({ verdict: "pass" }))).toContain("Nothing to fix.");
  });

  test("step locations, manual marker, explanation", () => {
    const text = formatPlanText(
      plan({
        steps: [
          step({ rank: 1 }),
          step({ rank: 2, file: "a.ts", fixClass: "floating-promise", autoFixable: true, explanation: "why" }),
          step({ rank: 3, file: "b.ts", line: 4 }),
        ],
      }),
    );
    expect(text).toContain("(no file) | manual (manual)");
    expect(text).toContain("a.ts | floating-promise\n");
    expect(text).toContain("b.ts:4 | manual (manual)");
    expect(text).toContain("why: r1; r2");
    expect(text).toContain("explain: why");
  });

  test("explainer lines with and without notice", () => {
    const base = { mode: "llm" as const, model: "m", calls: 2, cached: 1 };
    const withNotice = formatPlanText(plan({ explainer: { ...base, notice: "rate limited" } }));
    expect(withNotice).toContain("Explanations: llm (m, 2 request(s), 1 from cache)");
    expect(withNotice).toContain("Note: rate limited");
    expect(formatPlanText(plan({ explainer: base }))).not.toContain("Note:");
  });

  test("json is pretty printed", () => {
    expect(formatPlanJson(plan())).toMatch(/^\{\n {2}"schemaVersion": "1.0"/);
  });
});

function result(over: Partial<FixSessionResult> = {}): FixSessionResult {
  return { ok: true, mode: "propose", outcomes: [], decisions: [], skipped: [], patch: "", ...over };
}

describe("formatFixReport", () => {
  test("failure with and without message", () => {
    expect(formatFixReport(result({ ok: false, error: "bad" }))).toBe("Muraqib agent fix failed: bad\n");
    expect(formatFixReport(result({ ok: false }))).toContain("unknown error");
  });

  test("no outcomes", () => {
    expect(formatFixReport(result())).toContain("No fixes were produced.");
  });

  test("every status, notes, warnings, rejection keys", () => {
    const text = formatFixReport(
      result({
        outcomes: [
          { fix: fixOf({ title: "A", warnings: ["rotate it"] }), status: "applied" },
          { fix: fixOf({ title: "B" }), status: "verified", note: "apply mode only" },
          { fix: fixOf({ title: "C" }), status: "declined", note: "user said no" },
          {
            fix: fixOf({ title: "D" }),
            status: "rejected",
            note: "still there",
            verification: { accepted: false, reason: "r", stillPresent: ["m|C|f.ts|msg|extra"], introduced: ["m2|C2|g.ts"] },
          },
          { fix: fixOf({ title: "E" }), status: "verified", verification: { accepted: true, resolved: 1 } },
        ],
      }),
    );
    for (const s of ["[applied] A", "[verified] B", "[declined] C", "[rejected] D", "[verified] E"]) expect(text).toContain(s);
    expect(text).toContain("   apply mode only");
    expect(text).toContain("   WARNING: rotate it");
    expect(text).toContain("   - m | C | f.ts\n");
    expect(text).not.toContain("extra");
    expect(text).toContain("   - m2 | C2 | g.ts");
    expect(text).not.toContain("No fixes were produced");
  });

  test("decisions, skipped and patch path", () => {
    const text = formatFixReport(
      result({
        decisions: [{ issueId: "x1", question: "which?", options: [{ key: "a", label: "Option A" }, { key: "b", label: "Option B" }] }],
        skipped: [{ issueId: "s1", reason: "cannot" }],
      }),
      "/tmp/p.patch",
    );
    expect(text).toContain("Decision needed for x1: which?");
    expect(text).toContain("a: Option A   (--choose x1=a)");
    expect(text).toContain("b: Option B   (--choose x1=b)");
    expect(text).toContain("Skipped s1: cannot");
    expect(text).toContain("Patch written to /tmp/p.patch (apply with: git apply /tmp/p.patch)");
    expect(formatFixReport(result())).not.toContain("Patch written");
  });
});
