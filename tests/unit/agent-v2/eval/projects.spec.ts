import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { buildEvalProjects, type EvalProject, type ExpectedOutcome, type ProblemKind } from "../../../../src/agent-v2/eval/projects.js";

function find(id: string): EvalProject {
  const project = buildEvalProjects().find((p) => p.id === id);
  if (project === undefined) throw new Error(`missing project ${id}`);
  return project;
}

function count(project: EvalProject, pick: { kind?: ProblemKind; expected?: ExpectedOutcome }): number {
  return project.problems.filter((p) => (pick.kind === undefined || p.kind === pick.kind) && (pick.expected === undefined || p.expected === pick.expected)).length;
}

describe("planted projects", () => {
  test("there are three projects with the planted counts", () => {
    const projects = buildEvalProjects();
    expect(projects.map((p) => p.id)).toEqual(["api-basic", "worker-partial", "tricky"]);

    const a = find("api-basic");
    expect(a.problems).toHaveLength(9);
    expect(count(a, { kind: "floating-promise", expected: "fix" })).toBe(3);
    expect(count(a, { kind: "hardcoded-secret", expected: "fix" })).toBe(2);
    expect(count(a, { kind: "env-documentation", expected: "fix" })).toBe(4);
    expect(a.files.has(".env.example")).toBe(false);

    const b = find("worker-partial");
    expect(b.problems).toHaveLength(4);
    expect(count(b, { kind: "floating-promise" })).toBe(1);
    expect(count(b, { kind: "hardcoded-secret" })).toBe(1);
    expect(count(b, { kind: "env-documentation" })).toBe(2);
    expect(b.files.has(".env.example")).toBe(true);

    const c = find("tricky");
    expect(c.problems).toHaveLength(7);
    expect(count(c, { expected: "fix" })).toBe(1);
    expect(count(c, { expected: "decision" })).toBe(3);
    expect(count(c, { expected: "skip" })).toBe(3);
  });

  test("problem ids are unique and every file a problem points to exists", () => {
    const projects = buildEvalProjects();
    const ids = projects.flatMap((p) => p.problems.map((x) => x.id));
    expect(new Set(ids).size).toBe(ids.length);
    for (const project of projects) {
      for (const problem of project.problems) {
        if (problem.file !== ".env.example") expect(project.files.has(problem.file)).toBe(true);
      }
    }
  });

  test("the ground truth is not vacuous on the untouched project", () => {
    for (const project of buildEvalProjects()) {
      for (const problem of project.problems) {
        const holds = problem.check(project.files, project.files);
        // a problem still to be fixed must fail before the fix; one to keep unchanged must hold
        expect(holds, `${project.id}/${problem.id}`).toBe(problem.expected !== "fix");
      }
    }
  });

  test("the ground truth rejects a tree where a decision/skip statement was edited", () => {
    const c = find("tricky");
    const problem = c.problems.find((p) => p.id === "c-fp-plain");
    const edited = new Map(c.files);
    edited.set("src/plain.ts", (edited.get("src/plain.ts") ?? "").replace("  fetch(", "  await fetch("));
    expect(problem?.check(edited, c.files)).toBe(false);
  });

  test("every planted secret is generated at run time and is present in the files", () => {
    for (const project of buildEvalProjects()) {
      expect(project.secrets.length).toBeGreaterThan(0);
      for (const secret of project.secrets) {
        expect([...project.files.values()].some((text) => text.includes(secret))).toBe(true);
      }
    }
  });

  test("the source files contain no secret-like literal", () => {
    const sources = ["projects.ts", "run.ts", "format.ts"].map((f) => readFileSync(new URL(`../../../../src/agent-v2/eval/${f}`, import.meta.url), "utf-8"));
    for (const text of sources) {
      expect(text).not.toMatch(/sk_live_[A-Za-z0-9]{8}/);
      expect(text).not.toMatch(/BEGIN [A-Z ]*PRIVATE KEY-----/);
      expect(text).not.toMatch(/AKIA[0-9A-Z]{16}/);
    }
  });
});
