import { describe, expect, test } from "vitest";
import {
  CRITICAL_SCORE_CAP,
  SCORE_DOMAINS,
  SCORE_SEVERITIES,
  SEVERITY_PENALTY,
  calculateScorecard,
  classifyIssue,
  gradeFor,
  scoreDomainOf,
  scoreSeverityOf,
} from "../../../src/core/scorecard.js";
import type { ScoreDomain, ScoreSeverity, ScorecardFinding } from "../../../src/core/scorecard.js";

const GOLDEN = (name: string): string => `../../golden/scorecard/${name}.json`;

const repeat = (count: number, severity: ScorecardFinding["severity"], domain: ScoreDomain): ScorecardFinding[] =>
  Array.from({ length: count }, () => ({ severity, domain }));

/** Named scenarios whose full scorecards are pinned in tests/golden/scorecard/*.json. */
const SCENARIOS: Record<string, ScorecardFinding[]> = {
  clean: [],
  "info-only": repeat(3, "info", "code-quality"),
  "low-noise": [...repeat(3, "low", "code-quality"), ...repeat(1, "medium", "dependencies")],
  mixed: [
    ...repeat(1, "high", "security"),
    ...repeat(2, "medium", "dependencies"),
    ...repeat(3, "low", "code-quality"),
    ...repeat(1, "info", "security"),
  ],
  "single-critical": repeat(1, "critical", "security"),
  "critical-among-clean-domains": [...repeat(1, "critical", "dependencies"), ...repeat(1, "low", "code-quality")],
  "many-criticals": repeat(6, "critical", "security"),
  "floor-at-zero": [...repeat(5, "high", "security"), ...repeat(30, "medium", "code-quality")],
};

describe("calculateScorecard golden files", () => {
  test.each(Object.entries(SCENARIOS))("%s", async (name, findings) => {
    await expect(`${JSON.stringify(calculateScorecard(findings), null, 2)}\n`).toMatchFileSnapshot(GOLDEN(name));
  });
});

describe("calculateScorecard", () => {
  test("a clean project scores 100/A and is not capped", () => {
    const card = calculateScorecard([]);
    expect(card).toMatchObject({ score: 100, grade: "A", capped: false, findings: 0, info: 0 });
  });

  test("subtracts a fixed penalty per severity", () => {
    for (const severity of SCORE_SEVERITIES) {
      const card = calculateScorecard(repeat(1, severity, "security"));
      expect(card.uncappedScore).toBe(100 - SEVERITY_PENALTY[severity]);
    }
  });

  test("info findings are counted but never scored", () => {
    const card = calculateScorecard(repeat(50, "info", "security"));
    expect(card.score).toBe(100);
    expect(card.info).toBe(50);
    expect(card.findings).toBe(0);
  });

  test("hard cap: any critical finding limits the score to 59", () => {
    expect(CRITICAL_SCORE_CAP).toBe(59);
    // 100 - 25 = 75 uncapped, so the cap is what holds it at 59
    const card = calculateScorecard(repeat(1, "critical", "security"));
    expect(card.uncappedScore).toBe(75);
    expect(card.score).toBe(59);
    expect(card.capped).toBe(true);
    expect(card.grade).toBe("F");
  });

  test("hard cap: holds regardless of how much clean code surrounds the critical finding", () => {
    // A critical in one domain cannot be diluted by perfect scores elsewhere
    const card = calculateScorecard(repeat(1, "critical", "dependencies"));
    expect(card.score).toBe(59);
    const clean = card.byDomain.filter((d) => d.domain !== "dependencies");
    expect(clean.map((d) => d.score)).toEqual([100, 100]);
  });

  test("hard cap: never raises a score that is already below it", () => {
    const card = calculateScorecard(repeat(6, "critical", "security"));
    expect(card.uncappedScore).toBe(0);
    expect(card.score).toBe(0);
    expect(card.capped).toBe(false);
  });

  test("hard cap: removing the critical finding lifts the cap", () => {
    const withCritical = [...repeat(1, "critical", "security"), ...repeat(1, "low", "security")];
    const without = withCritical.filter((f) => f.severity !== "critical");
    expect(calculateScorecard(withCritical).score).toBeLessThanOrEqual(59);
    expect(calculateScorecard(without).score).toBe(99);
  });

  test("never drops below 0", () => {
    expect(calculateScorecard(repeat(1000, "high", "security")).score).toBe(0);
  });

  test("per-domain scores apply the same cap independently", () => {
    const card = calculateScorecard([...repeat(1, "critical", "security"), ...repeat(2, "low", "code-quality")]);
    const byDomain = Object.fromEntries(card.byDomain.map((d) => [d.domain, d]));
    expect(byDomain["security"]).toMatchObject({ score: 59, capped: true, grade: "F" });
    expect(byDomain["code-quality"]).toMatchObject({ score: 98, capped: false, grade: "A" });
    expect(byDomain["dependencies"]).toMatchObject({ score: 100, findings: 0 });
  });

  test("breakdowns always list every severity and every domain in a stable order", () => {
    const card = calculateScorecard([]);
    expect(card.bySeverity.map((row) => row.severity)).toEqual([...SCORE_SEVERITIES]);
    expect(card.byDomain.map((row) => row.domain)).toEqual([...SCORE_DOMAINS]);
  });

  test("severity breakdown reports counts and penalties", () => {
    const card = calculateScorecard([...repeat(2, "high", "security"), ...repeat(3, "low", "security")]);
    const rows = Object.fromEntries(card.bySeverity.map((r) => [r.severity, r]));
    expect(rows["high"]).toEqual({ severity: "high", count: 2, penalty: 20 });
    expect(rows["low"]).toEqual({ severity: "low", count: 3, penalty: 3 });
    expect(rows["critical"]).toEqual({ severity: "critical", count: 0, penalty: 0 });
  });

  test("is pure: deterministic, order-independent and does not mutate its input", () => {
    const findings = SCENARIOS["mixed"] ?? [];
    const snapshot = JSON.stringify(findings);
    const first = calculateScorecard(findings);
    const reversed = calculateScorecard([...findings].reverse());
    expect(calculateScorecard(findings)).toEqual(first);
    expect(reversed).toEqual(first);
    expect(JSON.stringify(findings)).toBe(snapshot);
  });

  test("score is always an integer between 0 and 100 for arbitrary mixes", () => {
    const severities: ScorecardFinding["severity"][] = ["critical", "high", "medium", "low", "info"];
    for (let seed = 0; seed < 200; seed++) {
      const findings = Array.from({ length: seed % 37 }, (_, i): ScorecardFinding => ({
        severity: severities[(seed * 7 + i * 3) % severities.length] ?? "info",
        domain: SCORE_DOMAINS[(seed + i) % SCORE_DOMAINS.length] ?? "security",
      }));
      const card = calculateScorecard(findings);
      for (const score of [card.score, ...card.byDomain.map((d) => d.score)]) {
        expect(Number.isInteger(score)).toBe(true);
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(100);
      }
      if (findings.some((f) => f.severity === "critical")) expect(card.score).toBeLessThanOrEqual(59);
    }
  });
});

describe("gradeFor", () => {
  test.each([
    [100, "A"], [90, "A"], [89, "B"], [80, "B"], [79, "C"], [70, "C"], [69, "D"], [60, "D"], [59, "F"], [0, "F"],
  ] as const)("%i is %s", (score, grade) => {
    expect(gradeFor(score)).toBe(grade);
  });

  test("the critical cap always yields a failing grade", () => {
    expect(gradeFor(CRITICAL_SCORE_CAP)).toBe("F");
  });
});

describe("scoreSeverityOf", () => {
  test.each<[Parameters<typeof scoreSeverityOf>[0], ScoreSeverity | "info"]>([
    [{ severity: "critical" }, "critical"],
    [{ severity: "error" }, "high"],
    [{ severity: "warning" }, "medium"],
    [{ severity: "info" }, "info"],
    // the scan layer's five-level `level` wins over its guard-level `severity`
    [{ severity: "info", level: "low" }, "low"],
    [{ severity: "error", level: "high" }, "high"],
    [{ severity: "warning", level: "medium" }, "medium"],
    [{ severity: "info", level: "info" }, "info"],
  ])("%j -> %s", (issue, expected) => {
    expect(scoreSeverityOf(issue)).toBe(expected);
  });
});

describe("scoreDomainOf", () => {
  test.each<[Parameters<typeof scoreDomainOf>[0], ScoreDomain]>([
    [{ module: "security-guard" }, "security"],
    [{ module: "dependency-guard" }, "dependencies"],
    [{ module: "compatibility-guard" }, "dependencies"],
    [{ module: "memory-guard" }, "code-quality"],
    [{ module: "async-guard" }, "code-quality"],
    [{ module: "config-guard" }, "code-quality"],
    [{}, "code-quality"],
    [{ category: "security", module: "scan" }, "security"],
    [{ category: "compatibility", module: "scan" }, "dependencies"],
    [{ category: "configuration", module: "scan" }, "code-quality"],
    [{ dependencyProblem: {}, category: "security", module: "scan" }, "dependencies"],
    [{ imageProblem: {}, module: "scan" }, "dependencies"],
    [{ tags: ["security"] }, "security"],
    [{ tags: ["dependencies"] }, "dependencies"],
    [{ tags: ["other"] }, "code-quality"],
  ])("%j -> %s", (issue, expected) => {
    expect(scoreDomainOf(issue)).toBe(expected);
  });

  test("an explicit category takes precedence over the producing module", () => {
    expect(scoreDomainOf({ category: "security", module: "dependency-guard" })).toBe("security");
  });
});

describe("classifyIssue", () => {
  test("combines severity and domain", () => {
    expect(classifyIssue({ severity: "error", module: "security-guard" })).toEqual({ severity: "high", domain: "security" });
    expect(classifyIssue({ severity: "info", level: "low", category: "compatibility" })).toEqual({
      severity: "low",
      domain: "dependencies",
    });
  });
});
