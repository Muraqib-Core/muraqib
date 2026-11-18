import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { DEFAULT_FIXERS } from "../../../src/agent-v2/fix/registry.js";
import { runFixSession } from "../../../src/agent-v2/fix/session.js";
import { verifyFix } from "../../../src/agent-v2/fix/verify.js";
import { collectIssues, createPlan } from "../../../src/agent-v2/planner.js";
import { BAD_SRC, fixContent, fixOf, hashTree } from "./fix/helpers.js";
import { fakeSecret, makeTmpProject, removeProject, writeProjectFile } from "./support.js";

/** v1 reports issue files with the operating system's separator (`src\\b.ts` on Windows). */
const posix = (file: string | undefined): string | undefined => file?.split("\\").join("/");

/** A floating promise the real floating-promise fixer repairs. */
const FIXABLE = 'export async function run(): Promise<void> {\n  fetch("/x");\n}\n';
const roots: string[] = [];
afterEach(() => {
  roots.splice(0).forEach(removeProject);
});
function project(files: Record<string, string>): string {
  const root = makeTmpProject("agent-v2-ignplan-");
  roots.push(root);
  writeProjectFile(root, "package.json", JSON.stringify({ name: "t", version: "1.0.0" }));
  Object.entries(files).forEach(([name, content]) => writeProjectFile(root, name, content));
  return root;
}
/** Files of plan steps under src/ (v1 config-guard noise about missing tsconfig etc. in tmp projects is left out). */
const files = async (root: string): Promise<(string | undefined)[]> =>
  (await createPlan({ projectRoot: root })).steps.map((s) => s.file).filter((f) => f?.startsWith("src/") === true);

describe("planner integration", () => {
  test("ignored files of every module are absent from the plan; counts stay consistent", async () => {
    const root = project({
      "src/a.ts": BAD_SRC,
      "src/legacy/b.ts": `${BAD_SRC}const k = "${fakeSecret()}";\nconst e = process.env.LEGACY_VAR;\n`,
      "src/c.ts": "export const ok = 1;\n",
      ".muraqibignore": "src/legacy/\n",
    });
    const plan = await createPlan({ projectRoot: root });
    expect(plan.ok).toBe(true);
    const planFiles = plan.steps.map((s) => s.file);
    expect(planFiles).toContain("src/a.ts");
    expect(planFiles.some((f) => f?.startsWith("src/legacy/") === true)).toBe(false);
    expect(plan.summary.total).toBe(plan.steps.length);
    expect(plan.summary.autoFixable + plan.summary.manual).toBe(plan.summary.total);
    expect(Object.values(plan.summary.byFixClass).reduce((a, b) => a + b, 0)).toBe(plan.summary.total);
  });

  test("without .muraqibignore the same files are reported", async () => {
    const root = project({ "src/legacy/b.ts": `${BAD_SRC}const k = "${fakeSecret()}";\n` });
    expect((await files(root)).filter((f) => f === "src/legacy/b.ts").length).toBeGreaterThan(1);
  });

  test("plans are deterministic and the verdict ignores filtered critical issues", async () => {
    const root = project({ "src/s.ts": `const k = "${fakeSecret()}";\n`, ".muraqibignore": "src/s.ts\n" });
    const first = await createPlan({ projectRoot: root });
    expect(await createPlan({ projectRoot: root })).toEqual(first);
    expect(first.steps.some((s) => s.file === "src/s.ts" || s.module === "agent-v2-secrets")).toBe(false);
  });

  test("missing and unreadable ignore files do not change the plan or throw", async () => {
    const files1 = { "src/a.ts": BAD_SRC };
    const plain = await createPlan({ projectRoot: project(files1) });
    const broken = project(files1);
    writeProjectFile(broken, ".muraqibignore/x", "y");
    const plan = await createPlan({ projectRoot: broken });
    expect(plan.steps.map((s) => s.issueId)).toEqual(plain.steps.map((s) => s.issueId));
  });

  test("scenario: detector patterns, examples and eval fixtures are omitted", async () => {
    const problem = {
      "src/core/secret-detector.ts": `export const example = "${fakeSecret()}";\n`,
      "src/core/secret-guard.ts": `export const sample = "${fakeSecret()}";\n`,
      "src/agent-v2/eval/projects.ts": "export const fixtureRead = process.env.FIXTURE_ONLY;\n",
      "src/real.ts": "export const real = process.env.REAL_VAR;\n",
      ".env.example": "OTHER=1\n",
    };
    const ignored = ["src/core/secret-detector.ts", "src/core/secret-guard.ts", "src/agent-v2/eval/projects.ts"];
    const before = await files(project(problem));
    ignored.forEach((f) => expect(before).toContain(f));
    const root = project({ ...problem, ".muraqibignore": `# detector patterns and fixtures\r\n${ignored.join("\r\n")}\r\n` });
    const after = await files(root);
    ignored.forEach((f) => expect(after).not.toContain(f));
    expect(after).toContain("src/real.ts");
  });
});

describe("fixer safety", () => {
  test("propose with DEFAULT_FIXERS never edits or patches an ignored file", async () => {
    const root = project({
      "src/ignored.ts": FIXABLE,
      "src/secret.ts": `export const k = "${fakeSecret()}";\n`,
      "src/b.ts": FIXABLE,
      ".muraqibignore": "src/ignored.ts\nsrc/secret.ts\n",
    });
    const hash = hashTree(root);
    const result = await runFixSession({ projectRoot: root, mode: "propose", fixers: DEFAULT_FIXERS });
    expect(result.ok).toBe(true);
    expect(result.patch).toContain("src/b.ts");
    expect(result.patch).not.toContain("src/ignored.ts");
    expect(result.patch).not.toContain("src/secret.ts");
    expect(hashTree(root)).toBe(hash);
  });

  test("apply mode leaves an ignored file byte-identical", async () => {
    const root = project({ "src/ignored.ts": FIXABLE, "src/b.ts": FIXABLE, ".muraqibignore": "src/ignored.ts\n" });
    await runFixSession({ projectRoot: root, mode: "apply", fixers: DEFAULT_FIXERS, approve: async () => true });
    expect(readFileSync(join(root, "src/ignored.ts"), "utf-8")).toBe(FIXABLE);
    expect(readFileSync(join(root, "src/b.ts"), "utf-8")).not.toBe(FIXABLE);
  });
});

describe("verifyFix consistency", () => {
  test("an ignored file's issues are neither 'still present' nor 'introduced'", async () => {
    const root = project({ "src/ignored.ts": BAD_SRC, "src/b.ts": BAD_SRC, ".muraqibignore": "src/ignored.ts\n" });
    const collected = await collectIssues(root);
    if (!collected.ok) throw new Error(collected.error);
    expect(collected.issues.every((i) => posix(i.file) !== "src/ignored.ts")).toBe(true);
    const target = collected.issues.find((i) => posix(i.file) === "src/b.ts");
    expect(target).toBeDefined();
    const fix = fixOf({
      resolves: [target?.id ?? ""],
      edits: [
        { file: "src/b.ts", content: fixContent(BAD_SRC) },
        // Makes the ignored file worse: must not count as an introduced issue.
        { file: "src/ignored.ts", content: `${BAD_SRC}function h(){\n  f();\n}\n` },
      ],
    });
    expect(await verifyFix(root, fix)).toEqual({ accepted: true, resolved: 1 });
  });

  test("a fix that only touches an ignored file does not resolve a visible issue", async () => {
    const root = project({ "src/ignored.ts": BAD_SRC, "src/b.ts": BAD_SRC, ".muraqibignore": "src/ignored.ts\n" });
    const collected = await collectIssues(root);
    if (!collected.ok) throw new Error(collected.error);
    const target = collected.issues.find((i) => posix(i.file) === "src/b.ts");
    const fix = fixOf({ resolves: [target?.id ?? ""], edits: [{ file: "src/ignored.ts", content: fixContent(BAD_SRC) }] });
    const outcome = await verifyFix(root, fix);
    expect(outcome.accepted).toBe(false);
  });
});
