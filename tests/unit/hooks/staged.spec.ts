import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { parseAddedLines, readStagedAdditions, unquoteGitPath } from "../../../src/hooks/staged.js";
import { git, initRepo, isolateGit, write } from "./git-fixture.js";

const patch = (...rows: string[]): string => `${rows.join("\n")}\n`;

describe("parseAddedLines", () => {
  test("returns added lines with their line numbers in the new file, per file", () => {
    const targets = parseAddedLines(
      patch(
        "diff --git a/a.ts b/a.ts",
        "index 111..222 100644",
        "--- a/a.ts",
        "+++ b/a.ts",
        "@@ -3,0 +4,2 @@ context",
        "+added one",
        "+added two",
        "@@ -10 +12 @@",
        "-old",
        "+changed",
        "diff --git a/b.ts b/b.ts",
        "--- /dev/null",
        "+++ b/b.ts",
        "@@ -0,0 +1 @@",
        "+first"
      )
    );
    expect(targets).toEqual([
      { file: "a.ts", lines: [{ line: 4, text: "added one" }, { line: 5, text: "added two" }, { line: 12, text: "changed" }] },
      { file: "b.ts", lines: [{ line: 1, text: "first" }] },
    ]);
  });

  test("a content line that starts with '++ ' is content, not a file header", () => {
    const targets = parseAddedLines(
      patch("diff --git a/a.ts b/a.ts", "--- a/a.ts", "+++ b/a.ts", "@@ -0,0 +1,2 @@", "+++ b/evil.ts", "+after")
    );
    expect(targets).toEqual([{ file: "a.ts", lines: [{ line: 1, text: "++ b/evil.ts" }, { line: 2, text: "after" }] }]);
  });

  test("ignores deletions, binary files, pure renames and the no-newline marker", () => {
    expect(
      parseAddedLines(
        patch(
          "diff --git a/gone.ts b/gone.ts",
          "--- a/gone.ts",
          "+++ /dev/null",
          "@@ -1 +0,0 @@",
          "-bye",
          "diff --git a/img.png b/img.png",
          "Binary files a/img.png and b/img.png differ",
          "diff --git a/old.ts b/new.ts",
          "similarity index 100%",
          "rename from old.ts",
          "rename to new.ts"
        )
      )
    ).toEqual([]);
    const noEol = parseAddedLines(patch("diff --git a/a b/a", "--- a/a", "+++ b/a", "@@ -0,0 +1 @@", "+text", "\\ No newline at end of file"));
    expect(noEol[0]?.lines).toEqual([{ line: 1, text: "text" }]);
  });

  test("strips carriage returns and handles file names with spaces and quoting", () => {
    const targets = parseAddedLines(
      patch(
        'diff --git "a/we\\"ird\\tname.ts" "b/we\\"ird\\tname.ts"',
        '--- "a/we\\"ird\\tname.ts"',
        '+++ "b/we\\"ird\\tname.ts"',
        "@@ -0,0 +1 @@",
        "+line\r",
        "diff --git a/my file.ts b/my file.ts",
        "--- a/my file.ts\t",
        "+++ b/my file.ts\t",
        "@@ -0,0 +1 @@",
        "+x"
      )
    );
    expect(targets.map((t) => t.file)).toEqual(['we"ird\tname.ts', "my file.ts"]);
    expect(targets[0]?.lines[0]?.text).toBe("line");
  });

  test("empty input has nothing to scan", () => {
    expect(parseAddedLines("")).toEqual([]);
  });
});

describe("unquoteGitPath", () => {
  test.each([
    ["plain.ts", "plain.ts"],
    ['"a\\tb"', "a\tb"],
    ['"q\\"q"', 'q"q'],
    ['"back\\\\slash"', "back\\slash"],
    ['"\\303\\251.ts"', "é.ts"],
    ['"emoji-😀.ts"', "emoji-😀.ts"],
    ['"unknown\\xescape"', "unknown\\xescape"],
  ])("%s -> %s", (raw, expected) => {
    expect(unquoteGitPath(raw)).toBe(expected);
  });
});

describe("readStagedAdditions (real git)", () => {
  let restore: () => void;
  beforeAll(() => {
    restore = isolateGit();
  });
  afterAll(() => restore());

  test("returns only staged additions, not committed content or unstaged edits", () => {
    const repo = initRepo();
    write(repo, "keep.ts", "old secret line\nstable\n");
    git(repo, "add", "-A");
    git(repo, "commit", "-qm", "base");

    write(repo, "keep.ts", "old secret line\nstable\nstaged addition\n");
    write(repo, "new.ts", "brand new\n");
    git(repo, "add", "keep.ts", "new.ts");
    write(repo, "keep.ts", "old secret line\nstable\nstaged addition\nunstaged edit\n");
    write(repo, "untracked.ts", "never added\n");

    expect(readStagedAdditions(repo)).toEqual([
      { file: "keep.ts", lines: [{ line: 3, text: "staged addition" }] },
      { file: "new.ts", lines: [{ line: 1, text: "brand new" }] },
    ]);
  });

  test("reads the staged blob even when the working tree file is changed again", () => {
    const repo = initRepo();
    write(repo, "a.ts", "const token = 'staged';\n");
    git(repo, "add", "a.ts");
    write(repo, "a.ts", "const token = 'clean';\n");
    expect(readStagedAdditions(repo)[0]?.lines[0]?.text).toBe("const token = 'staged';");
  });

  test("ignores deletions and binary files, and survives diff prefix configuration", () => {
    const repo = initRepo();
    write(repo, "gone.ts", "bye\n");
    git(repo, "add", "-A");
    git(repo, "commit", "-qm", "base");
    git(repo, "rm", "-q", "gone.ts");
    write(repo, "bin.dat", Buffer.from([0, 1, 2, 3, 0, 255]));
    write(repo, "real.ts", "text\n");
    git(repo, "add", "-A");
    git(repo, "config", "diff.mnemonicPrefix", "true");
    git(repo, "config", "diff.noprefix", "true");
    expect(readStagedAdditions(repo).map((t) => t.file)).toEqual(["real.ts"]);
  });

  test("a rename without edits adds nothing; edits to a renamed file add only the edited lines", () => {
    const repo = initRepo();
    write(repo, "old.ts", "one\ntwo\nthree\nfour\nfive\nsix\n");
    git(repo, "add", "-A");
    git(repo, "commit", "-qm", "base");
    git(repo, "mv", "old.ts", "new.ts");
    expect(readStagedAdditions(repo)).toEqual([]);
    write(repo, "new.ts", "one\ntwo\nthree\nfour\nfive\nsix\nseven\n");
    git(repo, "add", "new.ts");
    expect(readStagedAdditions(repo)).toEqual([{ file: "new.ts", lines: [{ line: 7, text: "seven" }] }]);
  });

  test("throws when git cannot produce the diff", () => {
    expect(() => readStagedAdditions("/definitely/not/a/directory")).toThrow("git diff --cached failed");
  });
});
