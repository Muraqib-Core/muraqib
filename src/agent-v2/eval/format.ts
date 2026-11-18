import type { EvalMetrics, EvalRates, EvaluationResult, Fraction, ProjectEvaluation } from "./run.js";

const PERCENT = 100;
const TENTHS = 10;
const JSON_INDENT = 2;

/** `n/d (xx.x%)`, the percentage cut down (never rounded up); `n/d (n/a)` when nothing was expected. */
function formatFraction(f: Fraction): string {
  if (f.value === null) return `${f.numerator}/${f.denominator} (n/a)`;
  const percent = Math.floor(f.value * PERCENT * TENTHS) / TENTHS;
  return `${f.numerator}/${f.denominator} (${percent.toFixed(1)}%)`;
}

function cell(value: string | number | null): string {
  return value === null ? "n/a" : String(value);
}

function pad(rows: readonly (readonly string[])[]): string[] {
  const widths = (rows[0] ?? []).map((_, col) => Math.max(...rows.map((r) => (r[col] ?? "").length)));
  return rows.map((r) => r.map((c, col) => (col === 0 ? c.padEnd(widths[col] ?? 0) : c.padStart(widths[col] ?? 0))).join("  ").trimEnd());
}

type Row = { label: string; metrics: EvalMetrics; rates: EvalRates; issuesBefore: number | null; issuesAfter: number | null; durationMs: number };

function rowOf(p: Row): string[] {
  const m = p.metrics;
  return [
    p.label,
    String(m.planted),
    String(m.expectedFix),
    String(m.fixedCorrectly),
    String(m.wronglyFixed),
    String(m.correctlyAsked),
    String(m.notAsked),
    String(m.missed),
    String(m.rejectedByVerification),
    cell(p.issuesBefore),
    cell(p.issuesAfter),
    String(p.durationMs),
  ];
}

const HEADER: readonly string[] = ["project", "planted", "exp.fix", "fixed", "WRONG", "asked", "not-asked", "missed", "rejected", "before", "after", "ms"];

function projectRow(p: ProjectEvaluation): string[] {
  return rowOf({ label: p.id, ...p });
}

function problemLines(p: ProjectEvaluation): string[] {
  return p.problems.map((r) => `  ${r.observed === "fixed" || r.observed === "asked" ? "ok  " : "FAIL"} ${p.id}/${r.id}: expected ${r.expected}, observed ${r.observed} - ${r.detail}`);
}

/**
 * Plain-text evaluation report: one table (a row per project plus the total), the fractions with
 * their raw counts, every planted problem with expected vs observed, and the explainer / Gemini status.
 *
 * @param result - Output of `runEvaluation`
 * @returns Text ending with a newline; contains no secret values
 */
export function formatEvaluationText(result: EvaluationResult): string {
  const rows = [HEADER, ...result.projects.map(projectRow), rowOf({ label: "TOTAL", ...result.total })];
  const t = result.total;
  const lines = [
    "Muraqib agent-v2 fixer evaluation (apply mode, built-in explanations, no network)",
    "",
    ...pad(rows),
    "",
    `Fixed correctly:       ${formatFraction(t.rates.fixedCorrectly)} of the problems expected to be fixed`,
    `Correctly asked/kept:  ${formatFraction(t.rates.correctlyAsked)} of the problems expected to be asked or skipped`,
    `Wrongly fixed:         ${formatFraction(t.rates.wronglyFixed)} of all planted problems (must be 0)`,
    "",
    "Problems:",
    ...result.projects.flatMap(problemLines),
  ];
  const collateral = result.projects.filter((p) => p.collateralFiles.length > 0);
  if (collateral.length > 0) lines.push("", "Unplanned file changes:", ...collateral.map((p) => `  ${p.id}: ${p.collateralFiles.join(", ")}`));
  const errors = result.projects.filter((p) => p.sessionError !== null);
  if (errors.length > 0) lines.push("", "Session errors:", ...errors.map((p) => `  ${p.id}: ${p.sessionError ?? ""}`));
  lines.push(
    "",
    `Explainers (built-in): ${result.explainers.totalExplainedSteps}/${result.explainers.totalSteps} steps explained; ${result.explainers.projects.map((e) => `${e.projectId}=${e.mode}`).join(", ")}`,
    `Gemini: measured=${String(result.gemini.measured)} - ${result.gemini.reason}`
  );
  return `${lines.join("\n")}\n`;
}

/**
 * The evaluation as pretty-printed JSON (all counts raw, fractions unrounded).
 *
 * @param result - Output of `runEvaluation`
 * @returns JSON text ending with a newline
 */
export function formatEvaluationJson(result: EvaluationResult): string {
  return `${JSON.stringify(result, null, JSON_INDENT)}\n`;
}
