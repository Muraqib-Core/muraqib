import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { SecretsToEnvFixer } from "../../../../src/agent-v2/fix/fixers/secrets-to-env.js";
import { applyEdits, copyProject, removeCopy } from "../../../../src/agent-v2/fix/project-copy.js";
import { makePatch } from "../../../../src/agent-v2/fix/patch.js";
import { DEFAULT_FIXERS } from "../../../../src/agent-v2/fix/registry.js";
import { runFixSession } from "../../../../src/agent-v2/fix/session.js";
import type { FixClass } from "../../../../src/agent-v2/types.js";
import type { ProposedFix } from "../../../../src/agent-v2/fix/types.js";
import { verifyFix } from "../../../../src/agent-v2/fix/verify.js";
import { createPlan } from "../../../../src/agent-v2/planner.js";
import { fakeSecret, makeTmpProject, removeProject, writeProjectFile } from "../support.js";

/** Windows line endings: every fixer must keep the file's own line endings byte for byte. */
const BOM = "﻿";
type Variant = "crlf" | "mixed" | "bom" | "no-final-newline";
const VARIANTS: readonly Variant[] = ["crlf", "mixed", "bom", "no-final-newline"];
const roots: string[] = [];

afterEach(() => {
  for (const r of roots.splice(0)) removeProject(r);
});

/** Joins lines with the line endings of the variant ("mixed" alternates LF and CRLF). */
function build(lines: readonly string[], variant: Variant): string {
  const body = lines.map((line, i) => `${line}${variant === "mixed" && i % 2 === 0 ? "\n" : "\r\n"}`).join("");
  if (variant === "bom") return BOM + body;
  return variant === "no-final-newline" ? body.replace(/\r\n$/, "") : body;
}

function project(files: Record<string, string>): string {
  const root = makeTmpProject("agent-v2-crlf-");
  roots.push(root);
  writeProjectFile(root, "package.json", JSON.stringify({ name: "t", version: "1.0.0" }));
  for (const [file, content] of Object.entries(files)) writeProjectFile(root, file, content);
  return root;
}

const bareLf = (s: string): number => (s.match(/(?<!\r)\n/g) ?? []).length;
const crlf = (s: string): number => (s.match(/\r\n/g) ?? []).length;

/** Asserts no line ending was converted and returns how many lines differ (added lines count too). */
function changedLines(before: string, after: string): number {
  expect(after).not.toMatch(/\r\r\n/);
  expect(bareLf(after)).toBe(bareLf(before));
  expect(crlf(after)).toBeGreaterThanOrEqual(crlf(before));
  expect(after.startsWith(BOM)).toBe(before.startsWith(BOM));
  const a = before.split("\n");
  const b = after.split("\n");
  let diff = Math.abs(a.length - b.length);
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) diff += 1;
  return diff;
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", ["-c", "core.autocrlf=false", ...args], { cwd, encoding: "utf-8" });
}

/** `git apply --check` on a copy of the original, then a real apply that must reproduce the edit byte for byte. */
function expectPatchApplies(root: string, patch: string, fix: ProposedFix): void {
  expect(patch).not.toBe("");
  const copy = copyProject(root);
  try {
    const file = join(copy, "..", `${copy.split(/[\\/]/).pop() ?? "x"}.patch`);
    writeFileSync(file, patch, "utf-8");
    git(copy, ["apply", "--check", file]);
    git(copy, ["apply", file]);
    for (const edit of fix.edits) expect(readFileSync(join(copy, edit.file), "utf-8")).toBe(edit.content);
    removeCopy(file);
  } finally {
    removeCopy(copy);
  }
}

/** Patch between the project and a copy with the fix applied (works for secret fixes, which the session keeps out of its patch). */
function patchOf(root: string, fix: ProposedFix): string {
  const copy = copyProject(root);
  try {
    applyEdits(copy, fix.edits);
    return makePatch(root, copy, fix.edits.map((e) => e.file));
  } finally {
    removeCopy(copy);
  }
}

interface Scenario {
  fixClass: FixClass;
  choice?: string;
  files: (variant: Variant) => Record<string, string>;
  /** File the fix must change, and the max number of lines that may differ in it. */
  target: string;
  maxChanged: number;
}

async function runScenario(s: Scenario, variant: Variant): Promise<void> {
  const files = s.files(variant);
  const root = project(files);
  const plan = await createPlan({ projectRoot: root });
  const step = plan.steps.find((x) => x.fixClass === s.fixClass && x.autoFixable);
  expect(step, "the audit must flag the scenario").toBeDefined();
  const choices = new Map<string, string>(s.choice === undefined || step === undefined ? [] : [[step.issueId, s.choice]]);
  const result = await runFixSession({ projectRoot: root, mode: "propose", choices, fixers: DEFAULT_FIXERS });
  const mine = result.outcomes.find((o) => o.fix.fixClass === s.fixClass);
  expect(mine?.status, JSON.stringify(result.outcomes.map((o) => [o.status, o.note, o.fix.title]))).toBe("verified");
  const fix = mine?.fix;
  if (fix === undefined) throw new Error("unreachable");
  expect(await verifyFix(root, fix)).toMatchObject({ accepted: true });
  for (const edit of fix.edits) {
    const before = files[edit.file];
    // A file that did not exist (a freshly created .env.example) has no line endings to preserve.
    if (before === undefined) continue;
    const diff = changedLines(before, edit.content);
    if (edit.file === s.target) expect(diff).toBeLessThanOrEqual(s.maxChanged);
  }
  expect(fix.edits.some((e) => e.file === s.target)).toBe(true);
  expectPatchApplies(root, patchOf(root, fix), fix);
  if (!fix.removesSecret) expectPatchApplies(root, result.patch, fix);
  else expect(result.patch).toBe("");
}

const AWAIT: Scenario = {
  fixClass: "floating-promise",
  target: "src/a.ts",
  maxChanged: 1,
  files: (v) => ({ "src/a.ts": build(["async function f(): Promise<void> {}", "async function g(): Promise<void> {", "  f();", "  const x = 1;", "  void x;", "}", "export { g };"], v) }),
};
const ASYNC_WRAP: Scenario = {
  fixClass: "floating-promise",
  choice: "async",
  target: "src/a.ts",
  maxChanged: 2,
  files: (v) => ({ "src/a.ts": build(["async function f(): Promise<void> {}", "function g(): void {", "  f();", "  const x = 1;", "  void x;", "}", "export { g };"], v) }),
};
const CATCH: Scenario = {
  fixClass: "floating-promise",
  choice: "catch",
  target: "src/a.ts",
  maxChanged: 1,
  files: (v) => ({ "src/a.ts": build(["async function f(): Promise<void> {}", "function g(): void {", "  f();", "  const x = 1;", "  void x;", "}", "export { g };"], v) }),
};
const SECRET: Scenario = {
  fixClass: "hardcoded-secret",
  target: "src/config.ts",
  maxChanged: 1,
  files: (v) => ({ "src/config.ts": build(["export const a = 1;", `export const stripeKey: string = "${fakeSecret()}";`, "export const b = 2;"], v) }),
};
const ENV_CREATE: Scenario = {
  fixClass: "env-documentation",
  target: ".env.example",
  maxChanged: 4,
  files: (v) => ({ "src/e.ts": build(["export const a = process.env.ALPHA;", "export const b = process.env.BETA;"], v) }),
};
const ENV_APPEND: Scenario = {
  fixClass: "env-documentation",
  target: ".env.example",
  maxChanged: 3,
  files: (v) => ({
    "src/e.ts": build(["export const a = process.env.ALPHA;", "export const b = process.env.BETA;"], v),
    ".env.example": build(["# keys", "ALPHA="], v),
  }),
};

describe.each<[string, Scenario]>([
  ["floating-promise: await insertion", AWAIT],
  ["floating-promise: async wrap", ASYNC_WRAP],
  ["floating-promise: .catch append", CATCH],
  ["secrets-to-env", SECRET],
  ["env-example: create", ENV_CREATE],
  ["env-example: append", ENV_APPEND],
])("%s keeps line endings", (_name, scenario) => {
  test.each(VARIANTS)("variant %s", async (variant) => {
    await runScenario(scenario, variant);
  });
});

describe("edge cases", () => {
  test("a bare call on the last line without newline gets .catch before nothing else", async () => {
    const root = project({ "src/a.ts": build(["async function f(): Promise<void> {}", "f()"], "no-final-newline") });
    const plan = await createPlan({ projectRoot: root });
    const step = plan.steps.find((x) => x.fixClass === "floating-promise");
    const choices = new Map<string, string>(step === undefined ? [] : [[step.issueId, "catch"]]);
    const result = await runFixSession({ projectRoot: root, mode: "propose", choices, fixers: DEFAULT_FIXERS });
    const fix = result.outcomes.find((o) => o.fix.fixClass === "floating-promise");
    expect(fix?.status).toBe("verified");
    expect(result.patch).toContain(".catch(");
    expect(bareLf(result.patch.split("\n").filter((l) => l.startsWith("+") && l.includes(".catch")).join("\n"))).toBe(0);
  });

  test("the secret fixer does not leave a CR inside the replaced line", async () => {
    const root = project({ "src/config.ts": build(["export const stripeKey: string = \"" + fakeSecret() + "\";"], "crlf") });
    const plan = await createPlan({ projectRoot: root });
    const results = new SecretsToEnvFixer().propose(plan.steps.filter((s) => s.fixClass === "hardcoded-secret"), { projectRoot: root, choices: new Map() });
    const fix = results.flatMap((r) => (r.kind === "fix" ? [r.fix] : []))[0];
    const edited = fix?.edits.find((e) => e.file === "src/config.ts")?.content;
    expect(edited).toBe("export const stripeKey: string = process.env.STRIPE_KEY;\r\n");
  });

  test("BOM + CRLF with the function header and the secret on line 1", async () => {
    const wrap = project({ "src/a.ts": build(["function g(): void { f(); }", "async function f(): Promise<void> {}", "export { g };"], "bom").replace("{ f(); }", "{\r\n  f();\r\n}") });
    const plan = await createPlan({ projectRoot: wrap });
    const step = plan.steps.find((x) => x.fixClass === "floating-promise");
    const choices = new Map<string, string>(step === undefined ? [] : [[step.issueId, "async"]]);
    const result = await runFixSession({ projectRoot: wrap, mode: "propose", choices, fixers: DEFAULT_FIXERS });
    expect(result.outcomes.find((o) => o.fix.fixClass === "floating-promise")?.status).toBe("verified");
    const edited = result.outcomes[0]?.fix.edits[0]?.content ?? "";
    expect(edited.startsWith(`${BOM}async function g(): Promise<void> {`)).toBe(true);
    expect(edited).toContain("  await f();\r\n");
    const secret = project({ "src/config.ts": BOM + `export const stripeKey: string = "${fakeSecret()}";\r\nexport const z = 1;\r\n` });
    const secretPlan = await createPlan({ projectRoot: secret });
    const fixes = new SecretsToEnvFixer().propose(secretPlan.steps.filter((x) => x.fixClass === "hardcoded-secret"), { projectRoot: secret, choices: new Map() });
    const fix = fixes.flatMap((r) => (r.kind === "fix" ? [r.fix] : []))[0];
    expect(fix?.edits[0]?.content).toBe(`${BOM}export const stripeKey: string = process.env.STRIPE_KEY;\r\nexport const z = 1;\r\n`);
  });
});
