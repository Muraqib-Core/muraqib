import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, test } from "vitest";
import { createPlan } from "../../../../../src/agent-v2/planner.js";
import { FloatingPromiseFixer } from "../../../../../src/agent-v2/fix/fixers/floating-promise.js";
import { DEFAULT_FIXERS } from "../../../../../src/agent-v2/fix/registry.js";
import { runFixSession } from "../../../../../src/agent-v2/fix/session.js";
import type { FixerResult } from "../../../../../src/agent-v2/fix/types.js";
import { verifyFix } from "../../../../../src/agent-v2/fix/verify.js";
import type { PlanStep } from "../../../../../src/agent-v2/types.js";
import { makeTmpProject, removeProject, writeProjectFile } from "../../support.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) removeProject(root);
});

function project(source: string): string {
  const root = makeTmpProject("agent-v2-fp-");
  roots.push(root);
  writeProjectFile(root, "package.json", JSON.stringify({ name: "fp-demo", version: "1.0.0" }));
  writeProjectFile(root, "src/app.ts", source);
  return root;
}

async function floatingSteps(root: string): Promise<PlanStep[]> {
  const plan = await createPlan({ projectRoot: root });
  return plan.steps.filter((step) => step.fixClass === "floating-promise");
}

function manualStep(over: Partial<PlanStep>): PlanStep {
  return {
    rank: 1,
    issueId: "manual-step",
    module: "async-guard",
    code: "ASYNC_FLOATING_PROMISE",
    severity: "error",
    title: "t",
    fixClass: "floating-promise",
    autoFixable: true,
    file: "src/app.ts",
    line: 1,
    reasons: [],
    ...over,
  };
}

/** Plans the project, runs the fixer on the single floating-promise step and returns it with the step. */
async function proposeOne(root: string, choices: Map<string, string> = new Map()): Promise<{ result: FixerResult; step: PlanStep }> {
  const steps = await floatingSteps(root);
  expect(steps).toHaveLength(1);
  const step = steps[0] as PlanStep;
  const [result] = new FloatingPromiseFixer().propose([step], { projectRoot: root, choices });
  return { result: result as FixerResult, step };
}

function fixOf(result: FixerResult): { content: string; warnings: string[]; title: string; resolves: string[] } {
  if (result.kind !== "fix") throw new Error(`expected a fix, got ${result.kind}`);
  const edit = result.fix.edits[0];
  if (edit === undefined || result.fix.edits.length !== 1) throw new Error("expected exactly one edit");
  return { content: edit.content, warnings: result.fix.warnings, title: result.fix.title, resolves: result.fix.resolves };
}

async function expectVerified(root: string, result: FixerResult): Promise<void> {
  if (result.kind !== "fix") throw new Error(`expected a fix, got ${result.kind}`);
  const outcome = await verifyFix(root, result.fix);
  expect(outcome).toMatchObject({ accepted: true });
}

describe("FloatingPromiseFixer inside async functions", () => {
  const cases: { name: string; source: string; expected: string }[] = [
    {
      name: "async function declaration",
      source: 'export async function run(): Promise<void> {\n  fetch("/x");\n}\n',
      expected: '  await fetch("/x");',
    },
    {
      name: "async arrow function",
      source: 'export const run = async (): Promise<void> => {\n  fetch("/x");\n};\n',
      expected: '  await fetch("/x");',
    },
    {
      name: "async method",
      source: 'export class Api {\n  async run(): Promise<void> {\n    fetch("/x");\n  }\n}\n',
      expected: '    await fetch("/x");',
    },
    {
      name: "multi-line statement",
      source: 'export async function run(): Promise<void> {\n  fetch("/x", {\n    method: "POST",\n  });\n}\n',
      expected: '  await fetch("/x", {\n    method: "POST",\n  });',
    },
    {
      name: "nested non-function blocks",
      source: 'export async function run(flag: boolean): Promise<void> {\n  if (flag) {\n    try {\n      fetch("/x");\n    } catch {\n      return;\n    }\n  }\n}\n',
      expected: '      await fetch("/x");',
    },
    {
      name: "missing await on a same-file async function",
      source: "async function save(): Promise<void> {}\n\nexport async function run(): Promise<void> {\n  save();\n}\n",
      expected: "  await save();",
    },
  ];

  test.each(cases)("$name gets an await and passes re-audit", async ({ source, expected }) => {
    const root = project(source);
    const { result, step } = await proposeOne(root);
    const fix = fixOf(result);
    expect(fix.content).toContain(expected);
    expect(fix.resolves).toEqual([step.issueId]);
    expect(fix.title).toMatch(/^Add await to \w+\(\) in src\/app\.ts:\d+$/);
    expect(fix.warnings).toEqual([]);
    if (result.kind === "fix") expect(result.fix.removesSecret).toBe(false);
    await expectVerified(root, result);
  });

  test("a string or comment containing braces does not confuse the function search", async () => {
    const source = 'export async function run(): Promise<void> {\n  const open = "{"; // } {\n  fetch("/x");\n}\n';
    const root = project(source);
    const { result } = await proposeOne(root);
    expect(fixOf(result).content).toContain('  await fetch("/x");');
    await expectVerified(root, result);
  });
});

describe("FloatingPromiseFixer outside async functions", () => {
  const plain = 'export function handler(): void {\n  fetch("/x");\n}\n';

  test("a plain function yields a decision with both options and no fix", async () => {
    const root = project(plain);
    const { result, step } = await proposeOne(root);
    expect(result.kind).toBe("decision");
    if (result.kind !== "decision") return;
    expect(result.decision.issueId).toBe(step.issueId);
    expect(result.decision.options.map((o) => o.key)).toEqual(["async", "catch"]);
  });

  test("choice async makes the function async, wraps the return type and passes re-audit", async () => {
    const root = project(plain);
    const steps = await floatingSteps(root);
    const { result } = await proposeOne(root, new Map([[steps[0]?.issueId ?? "", "async"]]));
    const fix = fixOf(result);
    expect(fix.content).toBe('export async function handler(): Promise<void> {\n  await fetch("/x");\n}\n');
    expect(fix.warnings.join(" ")).toMatch(/Callers of handler now receive a Promise/);
    await expectVerified(root, result);
  });

  test("choice async works for an arrow function and a method", async () => {
    const arrow = project('export const run = (): void => {\n  fetch("/x");\n};\n');
    const arrowSteps = await floatingSteps(arrow);
    const arrowResult = await proposeOne(arrow, new Map([[arrowSteps[0]?.issueId ?? "", "async"]]));
    expect(fixOf(arrowResult.result).content).toBe('export const run = async (): Promise<void> => {\n  await fetch("/x");\n};\n');
    await expectVerified(arrow, arrowResult.result);

    const method = project('export class Api {\n  public run(): void {\n    fetch("/x");\n  }\n}\n');
    const methodSteps = await floatingSteps(method);
    const methodResult = await proposeOne(method, new Map([[methodSteps[0]?.issueId ?? "", "async"]]));
    expect(fixOf(methodResult.result).content).toContain("public async run(): Promise<void> {");
    await expectVerified(method, methodResult.result);
  });

  test("choice catch appends a logging .catch() and passes re-audit", async () => {
    const root = project(plain);
    const steps = await floatingSteps(root);
    const { result } = await proposeOne(root, new Map([[steps[0]?.issueId ?? "", "catch"]]));
    const fix = fixOf(result);
    expect(fix.content).toContain('fetch("/x").catch((error: unknown) => { console.error(error); });');
    expect(fix.content).not.toContain("async");
    await expectVerified(root, result);
  });

  test("an invalid choice is skipped with a reason", async () => {
    const root = project(plain);
    const steps = await floatingSteps(root);
    const { result } = await proposeOne(root, new Map([[steps[0]?.issueId ?? "", "yolo"]]));
    expect(result).toMatchObject({ kind: "skip", reason: expect.stringContaining("yolo") });
  });

  test("a .then callback is a decision; async is refused because the callback is not a declaration", async () => {
    const source = 'export function run(): void {\n  Promise.resolve().then(() => {\n    fetch("/x");\n  }).catch((error: unknown) => { throw error; });\n}\n';
    const root = project(source);
    const first = await proposeOne(root);
    expect(first.result.kind).toBe("decision");
    const second = await proposeOne(root, new Map([[first.step.issueId, "async"]]));
    expect(second.result).toMatchObject({ kind: "skip", reason: expect.stringContaining("callback") });
  });

  test("a generator is not made async", async () => {
    const root = project('export function* gen(): Generator<number> {\n  fetch("/x");\n  yield 1;\n}\n');
    const steps = await floatingSteps(root);
    const { result } = await proposeOne(root, new Map([[steps[0]?.issueId ?? "", "async"]]));
    expect(result).toMatchObject({ kind: "skip", reason: expect.stringContaining("generator") });
  });

  test("an unwrappable return type is refused", async () => {
    const root = project('export function guard(value: unknown): value is string {\n  fetch("/x");\n  return typeof value === "string";\n}\n');
    const steps = await floatingSteps(root);
    const { result } = await proposeOne(root, new Map([[steps[0]?.issueId ?? "", "async"]]));
    expect(result).toMatchObject({ kind: "skip", reason: expect.stringContaining("return type") });
  });

  test("top level offers only the catch option; async is refused; catch is verified", async () => {
    const root = project('fetch("/x");\n');
    const first = await proposeOne(root);
    expect(first.result.kind).toBe("decision");
    if (first.result.kind === "decision") {
      expect(first.result.decision.options.map((o) => o.key)).toEqual(["catch"]);
      expect(first.result.decision.question).toContain("top level");
    }
    const asyncChoice = await proposeOne(root, new Map([[first.step.issueId, "async"]]));
    expect(asyncChoice.result.kind).toBe("skip");
    const catchChoice = await proposeOne(root, new Map([[first.step.issueId, "catch"]]));
    expect(fixOf(catchChoice.result).content).toContain(".catch(");
    await expectVerified(root, catchChoice.result);
  });

  test("a multi-line statement is not given a .catch() the audit would not recognise", async () => {
    const root = project('export function run(): void {\n  fetch("/x", {\n    method: "POST",\n  });\n}\n');
    const steps = await floatingSteps(root);
    const { result } = await proposeOne(root, new Map([[steps[0]?.issueId ?? "", "catch"]]));
    expect(result).toMatchObject({ kind: "skip", reason: expect.stringContaining("multi-line") });
  });
});

describe("FloatingPromiseFixer skips what it must not touch", () => {
  const source = [
    "export async function run(): Promise<void> {",
    '  await fetch("/a");',
    '  return fetch("/b");',
    '  void fetch("/c");',
    '  fetch("/d").then((r) => r);',
    '  const x = fetch("/e");',
    "}",
    "",
  ].join("\n");

  test.each([2, 3, 4, 5, 6])("line %i is skipped", async (line) => {
    const root = project(source);
    const [result] = new FloatingPromiseFixer().propose([manualStep({ line })], { projectRoot: root, choices: new Map() });
    expect(result?.kind).toBe("skip");
  });

  test("other codes, missing locations and missing files are skipped", () => {
    const root = project(source);
    const fixer = new FloatingPromiseFixer();
    const ctx = { projectRoot: root, choices: new Map<string, string>() };
    const results = fixer.propose(
      [manualStep({ code: "ASYNC_UNHANDLED_PROMISE" }), manualStep({ file: undefined as never }), manualStep({ file: "src/missing.ts" }), manualStep({ line: 99 }), manualStep({ file: "../outside.ts" })],
      ctx
    );
    expect(results.map((r) => r.kind)).toEqual(["skip", "skip", "skip", "skip", "skip"]);
  });
});

describe("verification protects against bad edits", () => {
  test("an edit that does not fix the issue is rejected by verifyFix", async () => {
    const root = project('export async function run(): Promise<void> {\n  fetch("/x");\n}\n');
    const { result, step } = await proposeOne(root);
    expect(result.kind).toBe("fix");
    const bad = {
      id: "floating-promise|bad",
      fixClass: "floating-promise" as const,
      title: "bad",
      resolves: [step.issueId],
      edits: [{ file: "src/app.ts", content: '// nothing changed\nexport async function run(): Promise<void> {\n  fetch("/x");\n}\n' }],
      warnings: [],
      removesSecret: false,
    };
    const outcome = await verifyFix(root, bad);
    expect(outcome.accepted).toBe(false);
  });
});

describe("runFixSession with DEFAULT_FIXERS", () => {
  test("fixes two floating promises in one async function and the patch applies cleanly", async () => {
    const source = 'export async function run(): Promise<void> {\n  fetch("/a");\n  fetch("/b");\n}\n';
    const root = project(source);
    const result = await runFixSession({ projectRoot: root, mode: "propose", fixers: DEFAULT_FIXERS });
    expect(result.ok).toBe(true);
    expect(result.outcomes.filter((o) => o.status === "verified")).toHaveLength(2);
    expect(result.outcomes.every((o) => o.status === "verified")).toBe(true);
    expect(result.patch).toContain('+  await fetch("/a");');
    expect(result.patch).toContain('+  await fetch("/b");');
    execFileSync("git", ["apply", "--check", "-"], { cwd: root, input: result.patch });
    expect((await floatingSteps(root)).length).toBe(2);
  });
});
