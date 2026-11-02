import { afterEach, describe, expect, test } from "vitest";
import { filterIgnoredIssues, IGNORE_FILE, loadIgnoreMatcher, toPosixPath } from "../../../src/agent-v2/ignore.js";
import type { AgentIssue } from "../../../src/agent/types.js";
import { makeTmpProject, removeProject, writeProjectFile } from "./support.js";

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) removeProject(r);
});
function project(ignoreText?: string): string {
  const root = makeTmpProject("agent-v2-ign-");
  roots.push(root);
  if (ignoreText !== undefined) writeProjectFile(root, IGNORE_FILE, ignoreText);
  return root;
}
function matches(ignoreText: string, file: string): boolean {
  const matcher = loadIgnoreMatcher(project(ignoreText));
  return matcher?.(file) ?? false;
}
function issue(id: string, file?: string): AgentIssue {
  const base: AgentIssue = { id, module: "m", code: "C", severity: "warning", title: "t", message: "m", tags: [] };
  return file === undefined ? base : { ...base, file };
}

describe(".muraqibignore semantics", () => {
  test("comments and blank lines are not patterns", () => {
    expect(matches("# src/a.ts\n\n   \n", "src/a.ts")).toBe(false);
    expect(loadIgnoreMatcher(project("# only a comment\n\n"))).toBeUndefined();
  });

  test("exact file, directory and glob patterns", () => {
    expect(matches("src/a.ts\n", "src/a.ts")).toBe(true);
    expect(matches("src/a.ts\n", "src/b.ts")).toBe(false);
    expect(matches("fixtures/\n", "fixtures/deep/x.ts")).toBe(true);
    expect(matches("fixtures/\n", "src/fixtures/x.ts")).toBe(true);
    expect(matches("/fixtures/\n", "src/fixtures/x.ts")).toBe(false);
    expect(matches("src/**/gen/*.ts\n", "src/a/b/gen/x.ts")).toBe(true);
    expect(matches("**/*.generated.ts\n", "a/b/c.generated.ts")).toBe(true);
    expect(matches("**/*.generated.ts\n", "a/b/c.ts")).toBe(false);
  });

  test("negation re-includes a file; the last matching rule wins", () => {
    const rules = "src/core/*.ts\n!src/core/keep.ts\n";
    expect(matches(rules, "src/core/drop.ts")).toBe(true);
    expect(matches(rules, "src/core/keep.ts")).toBe(false);
  });

  test("a negated file inside an ignored directory stays ignored (gitignore rule)", () => {
    expect(matches("legacy/\n!legacy/keep.ts\n", "legacy/keep.ts")).toBe(true);
    expect(matches("legacy/*\n!legacy/keep.ts\n", "legacy/keep.ts")).toBe(false);
  });

  test("CRLF line endings and a UTF-8 BOM are accepted", () => {
    const rules = "\uFEFFsrc/a.ts\r\n# note\r\nfixtures/\r\n";
    expect(matches(rules, "src/a.ts")).toBe(true);
    expect(matches(rules, "fixtures/x.ts")).toBe(true);
    expect(matches(rules, "src/b.ts")).toBe(false);
  });

  test("Windows-style and ./ paths are normalised", () => {
    expect(toPosixPath(".\\src\\a.ts")).toBe("src/a.ts");
    expect(matches("src/core/\n", "src\\core\\x.ts")).toBe(true);
    expect(matches("src/a.ts\n", "./src/a.ts")).toBe(true);
  });

  test("paths outside the project never match and never throw", () => {
    const matcher = loadIgnoreMatcher(project("*\n"));
    expect(matcher?.("../x.ts")).toBe(false);
    expect(matcher?.("/abs/x.ts")).toBe(false);
    expect(matcher?.("C:/x.ts")).toBe(false);
    expect(matcher?.("")).toBe(false);
  });

  test("missing or unreadable ignore file is a no-op", () => {
    expect(loadIgnoreMatcher(project())).toBeUndefined();
    const root = project();
    writeProjectFile(root, `${IGNORE_FILE}/inner`, "x"); // a directory where the file should be
    expect(loadIgnoreMatcher(root)).toBeUndefined();
    const issues = [issue("1", "src/a.ts")];
    expect(filterIgnoredIssues(root, issues)).toEqual(issues);
  });
});

describe("filterIgnoredIssues", () => {
  test("filters by file, keeps issues without a file and keeps order", () => {
    const root = project("src/skip/\n");
    const issues = [issue("1", "src/keep.ts"), issue("2", "src/skip/a.ts"), issue("3"), issue("4", "src\\skip\\b.ts")];
    expect(filterIgnoredIssues(root, issues).map((i) => i.id)).toEqual(["1", "3"]);
  });

  test("absolute issue files inside the project are matched relative to the root", () => {
    const root = project("src/skip/\n");
    expect(filterIgnoredIssues(root, [issue("1", `${root}/src/skip/a.ts`)])).toEqual([]);
  });
});
