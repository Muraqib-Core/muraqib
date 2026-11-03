import { describe, expect, test } from "vitest";
import { formatEvaluationJson, formatEvaluationText } from "../../../../src/agent-v2/eval/format.js";
import type { EvalMetrics, EvaluationResult, Fraction } from "../../../../src/agent-v2/eval/run.js";

const METRICS: EvalMetrics = { planted: 3, expectedFix: 3, expectedDecision: 0, expectedSkip: 0, fixedCorrectly: 2, wronglyFixed: 0, correctlyAsked: 0, notAsked: 0, missed: 1, rejectedByVerification: 0 };
const frac = (numerator: number, denominator: number): Fraction => ({ numerator, denominator, value: denominator === 0 ? null : numerator / denominator });
const RATES = { fixedCorrectly: frac(2, 3), correctlyAsked: frac(0, 0), wronglyFixed: frac(0, 3) };

function sample(): EvaluationResult {
  return {
    schemaVersion: "1.0",
    projects: [
      {
        id: "demo",
        description: "d",
        metrics: METRICS,
        rates: RATES,
        issuesBefore: 5,
        issuesAfter: null,
        durationMs: 7,
        sessionError: "audit failed",
        decisionsReported: 0,
        skipsReported: 0,
        collateralFiles: ["src/x.ts"],
        fixes: [],
        problems: [{ id: "p1", kind: "floating-promise", expected: "fix", file: "src/a.ts", observed: "missed", detail: "no fix was proposed" }],
      },
    ],
    total: { metrics: METRICS, rates: RATES, issuesBefore: 5, issuesAfter: null, durationMs: 7 },
    explainers: { network: false, projects: [{ projectId: "demo", steps: 2, explainedSteps: 2, mode: "fallback", calls: 0 }], totalSteps: 2, totalExplainedSteps: 2 },
    gemini: { measured: false, reason: "no key" },
  };
}

describe("formatEvaluationText", () => {
  test("shows raw counts and cuts the percentage down instead of rounding it up", () => {
    const text = formatEvaluationText(sample());
    expect(text).toContain("2/3 (66.6%)");
    expect(text).not.toContain("66.7%");
    expect(text).toContain("0/0 (n/a)");
  });

  test("lists failing problems, unknown counts, collateral files and session errors", () => {
    const text = formatEvaluationText(sample());
    expect(text).toContain("FAIL demo/p1: expected fix, observed missed");
    expect(text).toContain("n/a");
    expect(text).toContain("src/x.ts");
    expect(text).toContain("audit failed");
  });
});

describe("formatEvaluationJson", () => {
  test("round-trips", () => {
    const data = sample();
    expect(JSON.parse(formatEvaluationJson(data))).toEqual(data);
  });
});
