/**
 * Pure rendering helpers for the interactive audit report: colour-coded issue
 * lines and actionable next steps. No terminal-UI imports so it is easy to test.
 */
import chalk from "chalk";
import type { AuditReport } from "./types.js";

interface ReportIssue {
  severity: string;
  title: string;
  message: string;
  recommendation?: string | undefined;
  location?: { file?: string | undefined; line?: number | undefined } | undefined;
  dependencyProblem?: unknown;
}

export interface ModuleView {
  name: string;
  issues: ReportIssue[];
}

export interface NextStep {
  title: string;
  detail: string;
  /** Command that re-runs just the relevant checks. */
  command?: string;
}

const SEVERITY_ORDER = ["critical", "error", "warning", "info"] as const;

const paint: Record<string, (s: string) => string> = {
  critical: (s) => chalk.red.bold(s),
  error: (s) => chalk.red(s),
  warning: (s) => chalk.yellow(s),
  info: (s) => chalk.cyan(s),
};

function isReportIssue(value: unknown): value is ReportIssue {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v["severity"] === "string" && typeof v["title"] === "string" && typeof v["message"] === "string";
}

/** Extract the per-module issue lists from a report, worst modules first. */
export function getModuleViews(report: AuditReport): ModuleView[] {
  const views: ModuleView[] = [];
  for (const [name, data] of Object.entries(report.modules)) {
    const raw = typeof data === "object" && data !== null ? (data as { issues?: unknown }).issues : undefined;
    const issues = Array.isArray(raw) ? raw.filter(isReportIssue) : [];
    views.push({ name, issues });
  }
  const weight = (v: ModuleView): number => {
    const idx = SEVERITY_ORDER.findIndex((s) => v.issues.some((i) => i.severity === s));
    return idx === -1 ? SEVERITY_ORDER.length : idx;
  };
  return views.sort((a, b) => weight(a) - weight(b));
}

/** Compact "module  ✔ clean / ✖ 3 issues" overview, one line per module. */
export function renderOverview(views: readonly ModuleView[]): string {
  const width = Math.max(0, ...views.map((v) => v.name.length));
  return views
    .map((v) => {
      const name = v.name.padEnd(width);
      if (v.issues.length === 0) return `${chalk.green("✔")} ${name}  ${chalk.dim("clean")}`;
      const worst = SEVERITY_ORDER.find((s) => v.issues.some((i) => i.severity === s)) ?? "info";
      const mark = worst === "critical" || worst === "error" ? chalk.red("✖") : chalk.yellow("▲");
      return `${mark} ${name}  ${(paint[worst] ?? String)(`${v.issues.length} issue(s)`)}`;
    })
    .join("\n");
}

/** Colour-coded issue block for one module; `limit` caps the listed issues. */
export function renderModuleIssues(view: ModuleView, limit = 5): string {
  const sorted = [...view.issues].sort(
    (a, b) => SEVERITY_ORDER.indexOf(a.severity as never) - SEVERITY_ORDER.indexOf(b.severity as never)
  );
  const lines: string[] = [];
  for (const issue of sorted.slice(0, limit)) {
    const file = issue.location?.file;
    const where = file ? chalk.dim(` ${file}${issue.location?.line !== undefined ? `:${issue.location.line}` : ""}`) : "";
    lines.push(`${(paint[issue.severity] ?? String)(issue.severity.toUpperCase().padEnd(8))} ${issue.title}${where}`);
    lines.push(`  ${chalk.dim(issue.message)}`);
    if (issue.recommendation) lines.push(`  ${chalk.green("→")} ${issue.recommendation}`);
  }
  const hidden = sorted.length - limit;
  if (hidden > 0) lines.push(chalk.dim(`… and ${hidden} more`));
  return lines.join("\n");
}

const STEP_RULES: readonly { match: string; title: string; detail: string; filter: string }[] = [
  {
    match: "image",
    title: "Shrink oversized images",
    detail: "Resize and convert to WebP/AVIF (e.g. with sharp or squoosh) to get under the size budget.",
    filter: "image",
  },
  {
    match: "security",
    title: "Harden security",
    detail: "Add the missing security headers (CSP, HSTS, X-Content-Type-Options) and remove exposed secrets.",
    filter: "security",
  },
  {
    match: "config",
    title: "Fix configuration",
    detail: "Correct the flagged config files (tsconfig, package.json, env) and re-run to confirm.",
    filter: "config",
  },
  {
    match: "dependency",
    title: "Resolve dependency problems",
    detail: "Review the evidence-based resolution plan, approve it, and Muraqib verifies and rolls back on failure.",
    filter: "dependency",
  },
  {
    match: "dead-code",
    title: "Remove dead code",
    detail: "Delete unused exports/files, or add them to the ignore list if intentional.",
    filter: "dead-code",
  },
  {
    match: "memory",
    title: "Review memory usage",
    detail: "Check for leaks and unbounded caches in the flagged code.",
    filter: "memory",
  },
  {
    match: "async",
    title: "Tidy async patterns",
    detail: "Await or handle floating promises and parallelise independent awaits.",
    filter: "async",
  },
];

/** Turn a report into a short, prioritised list of concrete next steps. */
export function buildNextSteps(report: AuditReport): NextStep[] {
  const failing = getModuleViews(report).filter((v) => v.issues.length > 0);
  const steps: NextStep[] = [];
  for (const rule of STEP_RULES) {
    if (!failing.some((v) => v.name.includes(rule.match))) continue;
    const step: NextStep = { title: rule.title, detail: rule.detail, command: `muraqib audit -m ${rule.filter}` };
    if (rule.match === "dependency") step.command = "muraqib resolve";
    steps.push(step);
  }
  const osvFinding = failing.some((v) => v.issues.some((i) => i.dependencyProblem !== undefined));
  if (osvFinding && !steps.some((s) => s.command === "muraqib resolve")) {
    steps.push({
      title: "Resolve vulnerable dependencies",
      detail: "Build a verified upgrade plan from OSV data.",
      command: "muraqib resolve",
    });
  }
  return steps;
}
