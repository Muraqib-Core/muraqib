import { existsSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildEvalProjects } from "../../../../src/agent-v2/eval/projects.js";
import { runEvaluation, type EvaluationResult, type InspectInfo } from "../../../../src/agent-v2/eval/run.js";
import { formatEvaluationJson, formatEvaluationText } from "../../../../src/agent-v2/eval/format.js";
import type { Fixer, FixerResult } from "../../../../src/agent-v2/fix/types.js";
import type { PlanStep } from "../../../../src/agent-v2/types.js";

const TIMEOUT = 120_000;
const KEYS = ["GEMINI_API_KEY", "GOOGLE_API_KEY"] as const;

let result: EvaluationResult;
const inspected: InspectInfo[] = [];
const keysSeenDuringRun: (string | undefined)[] = [];
const saved = KEYS.map((k) => [k, process.env[k]] as const);
const fetchStub = vi.fn(() => Promise.reject(new Error("network must not be used")));

beforeAll(async () => {
  KEYS.forEach((k) => {
    process.env[k] = "not-a-real-key";
  });
  vi.stubGlobal("fetch", fetchStub);
  result = await runEvaluation({
    inspect: (info) => {
      inspected.push(info);
      keysSeenDuringRun.push(...KEYS.map((k) => process.env[k]));
    },
  });
}, TIMEOUT);

afterAll(() => {
  vi.unstubAllGlobals();
  saved.forEach(([k, v]) => {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  });
});

const project = (id: string): EvaluationResult["projects"][number] => {
  const found = result.projects.find((p) => p.id === id);
  if (found === undefined) throw new Error(`missing ${id}`);
  return found;
};

describe("runEvaluation with the real fixers", () => {
  test("reports the planted counts", () => {
    expect(result.projects.map((p) => [p.id, p.metrics.planted, p.metrics.expectedFix])).toEqual([
      ["api-basic", 9, 9],
      ["worker-partial", 4, 4],
      ["tricky", 7, 1],
    ]);
    expect(result.total.metrics.planted).toBe(20);
    expect(result.total.metrics.expectedDecision).toBe(3);
    expect(result.total.metrics.expectedSkip).toBe(3);
  });

  test("never wrongly fixes anything", () => {
    result.projects.forEach((p) => expect(p.metrics.wronglyFixed, p.id).toBe(0));
    expect(result.total.metrics.wronglyFixed).toBe(0);
    expect(result.total.rates.wronglyFixed.numerator).toBe(0);
  });

  test("every problem lands in exactly one bucket and the totals add up", () => {
    result.projects.forEach((p) => {
      const m = p.metrics;
      expect(m.fixedCorrectly + m.wronglyFixed + m.correctlyAsked + m.notAsked + m.missed + m.rejectedByVerification, p.id).toBe(m.planted);
      expect(p.problems).toHaveLength(m.planted);
    });
    const sum = (pick: (m: EvaluationResult["total"]["metrics"]) => number): number => result.projects.reduce((acc, p) => acc + pick(p.metrics), 0);
    expect(result.total.metrics.fixedCorrectly).toBe(sum((m) => m.fixedCorrectly));
    expect(result.total.metrics.missed).toBe(sum((m) => m.missed));
  });

  test("the tricky project is asked or left alone, with one easy fix", () => {
    const c = project("tricky");
    expect(c.metrics.correctlyAsked).toBe(6);
    expect(c.metrics.notAsked).toBe(0);
    expect(c.problems.find((p) => p.id === "c-fp-easy")?.observed).toBe("fixed");
    expect(c.decisionsReported).toBe(3);
  });

  test("fractions keep raw counts and are not rounded", () => {
    const { fixedCorrectly } = result.total.rates;
    expect(fixedCorrectly.denominator).toBe(result.total.metrics.expectedFix);
    expect(fixedCorrectly.numerator).toBe(result.total.metrics.fixedCorrectly);
    expect(fixedCorrectly.value).toBe(fixedCorrectly.numerator / fixedCorrectly.denominator);
  });

  test("gemini is reported as not measured, with no key and no network", () => {
    expect(result.gemini.measured).toBe(false);
    expect(result.gemini.reason.length).toBeGreaterThan(0);
    expect(result.explainers.network).toBe(false);
    expect(keysSeenDuringRun.every((v) => v === undefined)).toBe(true);
    expect(fetchStub).not.toHaveBeenCalled();
    result.explainers.projects.forEach((e) => {
      expect(e.mode).toBe("fallback");
      expect(e.calls).toBe(0);
      expect(e.explainedSteps).toBe(e.steps);
    });
  });

  test("the key variables are restored after the run", () => {
    KEYS.forEach((k) => expect(process.env[k]).toBe("not-a-real-key"));
  });

  test("temp projects are removed after the run", () => {
    expect(inspected).toHaveLength(3);
    inspected.forEach((i) => expect(existsSync(i.root), i.projectId).toBe(false));
  });
});

describe("secrets never leak", () => {
  const projects = buildEvalProjects();

  test("fixed secrets are gone from the final files, and any left over belong to a problem that was not fixed", () => {
    inspected.forEach((info) => {
      const planted = projects.find((p) => p.id === info.projectId);
      const evaluated = project(info.projectId);
      const unfixedFiles = new Set(evaluated.problems.filter((p) => p.kind === "hardcoded-secret" && p.observed !== "fixed").map((p) => p.file));
      planted?.secrets.forEach((secret) => {
        [...info.files.entries()].filter(([, text]) => text.includes(secret)).forEach(([file]) => expect(unfixedFiles.has(file), `${info.projectId}:${file}`).toBe(true));
      });
    });
  });

  test("the serialized result and the text never contain a secret value", () => {
    const outputs = [JSON.stringify(result), formatEvaluationJson(result), formatEvaluationText(result)];
    projects.flatMap((p) => p.secrets).forEach((secret) => outputs.forEach((out) => expect(out.includes(secret)).toBe(false)));
  });

  test("the text contains the table and the Gemini status", () => {
    const text = formatEvaluationText(result);
    expect(text).toContain("TOTAL");
    expect(text).toContain("api-basic");
    expect(text).toContain("Gemini: measured=false");
  });
});

/** Deliberately wrong fixer: blindly applies `rewrite` to the reported line of every floating promise. */
function wrongFixer(rewrite: (line: string) => string): Fixer {
  return {
    fixClass: "floating-promise",
    propose(steps: readonly PlanStep[], context): FixerResult[] {
      return steps.flatMap((step): FixerResult[] => {
        if (step.file === undefined || step.line === undefined) return [];
        const lines = readFileSync(join(context.projectRoot, step.file), "utf-8").split("\n");
        lines[step.line - 1] = rewrite(lines[step.line - 1] ?? "");
        const title = `blind edit ${step.file}:${step.line}`;
        return [{ kind: "fix", fix: { id: `floating-promise|${title}`, fixClass: "floating-promise", title, resolves: [step.issueId], edits: [{ file: step.file, content: lines.join("\n") }], warnings: [], removesSecret: false } }];
      });
    },
  };
}

describe("the wronglyFixed metric is not vacuous", () => {
  test("detects edits where a decision was expected", async () => {
    const tricky = buildEvalProjects().filter((p) => p.id === "tricky");
    const bad = await runEvaluation({ projects: tricky, fixers: [wrongFixer((l) => l.replace(/^(\s*)fetch\(/, "$1await fetch("))] });
    const c = bad.projects[0];
    expect(c?.metrics.wronglyFixed).toBeGreaterThanOrEqual(3);
    expect(c?.problems.filter((p) => p.expected === "decision" && p.observed === "wrongly-fixed")).toHaveLength(3);
    expect(bad.total.metrics.wronglyFixed).toBe(c?.metrics.wronglyFixed);
  }, TIMEOUT);

  test("detects an accepted fix whose ground truth fails", async () => {
    const api = buildEvalProjects().filter((p) => p.id === "api-basic");
    const bad = await runEvaluation({ projects: api, fixers: [wrongFixer((l) => l.replace(/^(\s*)fetch\(/, "$1void fetch("))] });
    const a = bad.projects[0];
    expect(a?.metrics.wronglyFixed).toBeGreaterThan(0);
    expect(a?.problems.find((p) => p.id === "a-fp-simple")?.observed).toBe("wrongly-fixed");
    expect(a?.metrics.fixedCorrectly).toBe(0);
  }, TIMEOUT);

  test("an empty fixer list fixes nothing and everything expected is missed", async () => {
    const api = buildEvalProjects().filter((p) => p.id === "api-basic");
    const none = await runEvaluation({ projects: api, fixers: [] });
    expect(none.projects[0]?.metrics.missed).toBe(9);
    expect(none.total.metrics.wronglyFixed).toBe(0);
  }, TIMEOUT);
});
