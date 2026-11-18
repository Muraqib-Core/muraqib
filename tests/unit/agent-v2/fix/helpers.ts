import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { AgentIssue } from "../../../../src/agent/types.js";
import type { Fixer, FixerResult, ProposedFix } from "../../../../src/agent-v2/fix/types.js";

export const BAD_SRC = "async function f(){}\nfunction g(){\n  f();\n}\n";
export const GOOD_SRC = "async function f(){}\nasync function g(){\n  await f();\n}\n";

export function tmp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function put(root: string, file: string, content: string): void {
  const target = join(root, file);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

/** Tiny project the real v1 AsyncGuard flags (floating call to an async function). */
export function badProject(files: readonly string[] = ["src/a.ts"]): string {
  const root = tmp("agent-v2-fixtest-");
  put(root, "package.json", JSON.stringify({ name: "fixtest", version: "1.0.0" }));
  for (const f of files) put(root, f, BAD_SRC);
  return root;
}

/** Hash of every file path + content under root, so "project untouched" can be asserted. */
export function hashTree(root: string): string {
  const hash = createHash("sha256");
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      if (name === ".git") continue;
      if (statSync(full).isDirectory()) walk(full);
      else hash.update(full.slice(root.length)).update(readFileSync(full));
    }
  };
  walk(root);
  return hash.digest("hex");
}

export function issue(id: string, message: string, extra: Partial<AgentIssue> = {}): AgentIssue {
  return { id, module: "m", code: "C", severity: "warning", title: "t", message, tags: [], file: "src/a.ts", ...extra };
}

export function fixOf(overrides: Partial<ProposedFix> = {}): ProposedFix {
  return { id: "floating-promise|t", fixClass: "floating-promise", title: "t", resolves: [], edits: [], warnings: [], removesSecret: false, ...overrides };
}

/** Real fix for the BAD_SRC pattern: adds await and async. */
export function fixContent(src: string): string {
  return src.replace("  f();", "  await f();").replace("function g", "async function g");
}

export interface FakeFixerOptions {
  /** Edits produce no improvement. */
  noop?: boolean;
  removesSecret?: boolean;
  decision?: boolean;
}

/** Fake floating-promise fixer: one fix per step, distinct id per file. */
export function fakeFixer(options: FakeFixerOptions = {}): Fixer {
  return {
    fixClass: "floating-promise",
    propose(steps, context): FixerResult[] {
      return steps.map((step): FixerResult => {
        if (options.decision === true) {
          return { kind: "decision", decision: { issueId: step.issueId, question: "which?", options: [{ key: "a", label: "A" }] } };
        }
        const file = step.file ?? "src/a.ts";
        const current = readFileSync(join(context.projectRoot, file), "utf-8");
        const content = options.noop === true ? `${current}// touched\n` : fixContent(current);
        return { kind: "fix", fix: fixOf({ id: `floating-promise|${file}`, title: `fix ${file}`, resolves: [step.issueId], edits: [{ file, content }], removesSecret: options.removesSecret === true }) };
      });
    },
  };
}
