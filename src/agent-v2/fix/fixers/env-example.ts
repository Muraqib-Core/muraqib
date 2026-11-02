import { existsSync, readFileSync } from "node:fs";
import { collectUsages, readDocumentedKeys } from "../../detectors/env.js";
import type { PlanStep } from "../../types.js";
import { resolveInside } from "../project-copy.js";
import type { FixContext, Fixer, FixerResult } from "../types.js";

const ENV_EXAMPLE = ".env.example";
const HEADER = "# Environment variables used by this project.\n# Copy to .env and fill in the values. Never commit real secrets.\n";
// Accepts a plain environment variable name: "STRIPE_KEY" matches, "1BAD-NAME" does not.
const VALID_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** What {@link planEnvExample} decided: the full new file content and the variable names it adds. */
export interface EnvExamplePlan {
  content: string;
  /** Names appended (sorted). Empty when the file already documents everything. */
  added: string[];
  /** True when `.env.example` already existed. */
  existed: boolean;
}

/**
 * Computes the new `.env.example`: every variable the source reads plus `extraNames`, as `NAME=`
 * lines with no values. An existing file is kept byte for byte and only missing names are appended.
 *
 * @param projectRoot - Project root to scan
 * @param extraNames - Additional variable names to document
 * @returns The new content, the names added and whether the file existed
 */
export function planEnvExample(projectRoot: string, extraNames: readonly string[] = []): EnvExamplePlan {
  const path = resolveInside(projectRoot, ENV_EXAMPLE);
  const existing = existsSync(path) ? readFileSync(path, "utf-8") : undefined;
  const documented = readDocumentedKeys(projectRoot) ?? new Set<string>();
  const wanted = new Set<string>([...collectUsages(projectRoot).keys(), ...extraNames.filter((n) => VALID_NAME.test(n))]);
  const added = [...wanted].filter((name) => !documented.has(name)).sort();
  if (existing === undefined) return { content: `${HEADER}${added.map((n) => `${n}=\n`).join("")}`, added, existed: false };
  if (added.length === 0) return { content: existing, added, existed: true };
  const eol = existing.includes("\r\n") ? "\r\n" : "\n";
  const base = existing === "" || existing.endsWith("\n") ? existing : `${existing}${eol}`;
  return { content: `${base}${added.map((n) => `${n}=${eol}`).join("")}`, added, existed: true };
}

/**
 * Content of the new `.env.example` (see {@link planEnvExample}).
 *
 * @param projectRoot - Project root to scan
 * @param extraNames - Additional variable names to document
 * @returns Full file content, names only, never values
 */
export function buildEnvExample(projectRoot: string, extraNames: readonly string[] = []): string {
  return planEnvExample(projectRoot, extraNames).content;
}

/**
 * Fixer for `env-documentation` (ENV_EXAMPLE_MISSING / ENV_UNDOCUMENTED, severity warning).
 * Produces ONE grouped fix that creates or extends `.env.example` with every undocumented
 * variable, values left empty.
 */
export class EnvExampleFixer implements Fixer {
  readonly fixClass = "env-documentation" as const;

  propose(steps: readonly PlanStep[], context: FixContext): FixerResult[] {
    if (steps.length === 0) return [];
    const plan = planEnvExample(context.projectRoot);
    if (plan.added.length === 0) {
      return steps.map((s) => ({ kind: "skip" as const, issueId: s.issueId, reason: "nothing to add to .env.example" }));
    }
    const verb = plan.existed ? "Update" : "Create";
    return [
      {
        kind: "fix",
        fix: {
          id: `env-documentation|${verb} ${ENV_EXAMPLE}`,
          fixClass: "env-documentation",
          title: `${verb} ${ENV_EXAMPLE} with ${plan.added.length} variable(s)`,
          resolves: steps.map((s) => s.issueId),
          edits: [{ file: ENV_EXAMPLE, content: plan.content }],
          warnings: [],
          removesSecret: false,
        },
      },
    ];
  }
}
