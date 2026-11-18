import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  DEFAULT_BIN,
  HOOK_NAMES,
  SKIP_ENV,
  blockEnd,
  blockStart,
  isShellHook,
  removeHookBlock,
  renderHookBlock,
  upsertHookBlock,
} from "../../../src/hooks/hook-script.js";

const ORIGINAL = "#!/bin/sh\nnpx lint-staged\necho done\n";

describe("renderHookBlock", () => {
  test.each(HOOK_NAMES)("%s block is delimited by exact markers and runs `hook run`", (hook) => {
    const lines = renderHookBlock(hook);
    expect(lines[0]).toBe(blockStart(hook));
    expect(lines[lines.length - 1]).toBe(blockEnd(hook));
    expect(lines.join("\n")).toContain(`hook run ${hook}`);
    expect(lines.join("\n")).toContain(SKIP_ENV);
  });

  test("uses the supplied project-local binary", () => {
    expect(renderHookBlock("pre-commit", "packages/app/node_modules/.bin/muraqib").join("\n")).toContain('"./packages/app/node_modules/.bin/muraqib"');
    expect(renderHookBlock("pre-commit").join("\n")).toContain(`./${DEFAULT_BIN}`);
  });
});

describe("upsertHookBlock", () => {
  test("creates a new executable-style script with a shebang", () => {
    const edit = upsertHookBlock(undefined, "pre-commit");
    expect(edit.action).toBe("created");
    expect(edit.content.startsWith("#!/bin/sh\n# >>> muraqib pre-commit >>>")).toBe(true);
    expect(edit.content.endsWith("# <<< muraqib pre-commit <<<\n")).toBe(true);
  });

  test("adds the block after the shebang of an existing hook and keeps every other line", () => {
    const edit = upsertHookBlock(ORIGINAL, "pre-commit");
    expect(edit.action).toBe("appended");
    const lines = edit.content.split("\n");
    expect(lines[0]).toBe("#!/bin/sh");
    expect(lines[1]).toBe(blockStart("pre-commit"));
    expect(edit.content).toContain("npx lint-staged\necho done\n");
  });

  test("adds the block at the top of a hook without a shebang (Husky)", () => {
    const edit = upsertHookBlock('. "$(dirname "$0")/_/husky.sh"\nnpx lint-staged\n', "pre-commit");
    expect(edit.content.startsWith(blockStart("pre-commit"))).toBe(true);
    expect(edit.content).toContain('. "$(dirname "$0")/_/husky.sh"\nnpx lint-staged\n');
  });

  test("a trailing `exec` in the existing hook cannot prevent the block from running", () => {
    const edit = upsertHookBlock("#!/bin/sh\nexec npx lint-staged\n", "pre-commit");
    expect(edit.content.indexOf(blockStart("pre-commit"))).toBeLessThan(edit.content.indexOf("exec npx lint-staged"));
  });

  test("is idempotent", () => {
    const first = upsertHookBlock(ORIGINAL, "pre-commit").content;
    expect(upsertHookBlock(first, "pre-commit")).toEqual({ content: first, action: "unchanged" });
  });

  test("refreshes an outdated block in place", () => {
    const outdated = upsertHookBlock(ORIGINAL, "pre-commit", "old/bin/muraqib").content;
    const edit = upsertHookBlock(outdated, "pre-commit");
    expect(edit.action).toBe("updated");
    expect(edit.content).not.toContain("old/bin/muraqib");
    expect(edit.content.split(blockStart("pre-commit"))).toHaveLength(2);
  });

  test("keeps CRLF line endings", () => {
    const edit = upsertHookBlock("#!/bin/sh\r\necho hi\r\n", "pre-commit");
    expect(edit.content).toContain("\r\n");
    expect(edit.content.replace(/\r\n/g, "")).not.toContain("\n");
  });

  test("pre-commit and pre-push blocks coexist independently", () => {
    const both = upsertHookBlock(upsertHookBlock(ORIGINAL, "pre-commit").content, "pre-push").content;
    expect(both).toContain(blockStart("pre-commit"));
    expect(both).toContain(blockStart("pre-push"));
  });

  test("refuses a block whose closing marker is missing", () => {
    expect(() => upsertHookBlock(`#!/bin/sh\n${blockStart("pre-commit")}\necho hand edited\n`, "pre-commit")).toThrow(/closing marker/);
  });
});

describe("removeHookBlock", () => {
  test.each([
    ["a shebang script", ORIGINAL],
    ["a script without trailing newline", "#!/bin/sh\necho hi"],
    ["a Husky hook without shebang", '. "$(dirname "$0")/_/husky.sh"\nnpx lint-staged\n'],
    ["a CRLF script", "#!/bin/sh\r\necho hi\r\n"],
    ["a bash script", "#!/usr/bin/env bash\nset -e\necho hi\n"],
  ])("install then remove restores %s byte for byte", (_name, original) => {
    const installed = upsertHookBlock(original, "pre-commit").content;
    const removed = removeHookBlock(installed, "pre-commit");
    expect(removed).toMatchObject({ action: "removed", empty: false });
    expect(removed.content).toBe(original);
  });

  test("removing one hook's block leaves the other's", () => {
    const both = upsertHookBlock(upsertHookBlock(ORIGINAL, "pre-commit").content, "pre-push").content;
    const edit = removeHookBlock(both, "pre-push");
    expect(edit.content).toContain(blockStart("pre-commit"));
    expect(edit.content).not.toContain(blockStart("pre-push"));
  });

  test("a file Muraqib created is reported empty so it can be deleted", () => {
    const created = upsertHookBlock(undefined, "pre-commit").content;
    expect(removeHookBlock(created, "pre-commit")).toMatchObject({ action: "removed", empty: true });
  });

  test("reports absent when there is no block", () => {
    expect(removeHookBlock(ORIGINAL, "pre-commit")).toEqual({ content: ORIGINAL, action: "absent" });
  });

  test("refuses a malformed block", () => {
    expect(() => removeHookBlock(`${blockStart("pre-push")}\n`, "pre-push")).toThrow(/closing marker/);
  });
});

describe("isShellHook", () => {
  test.each([
    ["", true],
    ["echo hi\n", true],
    ["#!/bin/sh\n", true],
    ["#!/bin/bash\n", true],
    ["#!/usr/bin/env sh\n", true],
    ["#!/usr/bin/env bash\n", true],
    ["#!/usr/bin/env -S bash -e\n", true],
    ["#!/bin/zsh -f\n", true],
    ["#!/usr/bin/env node\n", false],
    ["#!/usr/bin/env python3\n", false],
    ["#!/usr/bin/perl\n", false],
  ])("%j -> %s", (content, expected) => {
    expect(isShellHook(content)).toBe(expected);
  });
});

describe.skipIf(process.platform === "win32")("the generated block, run by a real shell", () => {
  function run(options: { exit?: number | "missing"; env?: Record<string, string>; flags?: string[]; trailing?: boolean }): { status: number | null; calls: string; stderr: string; after: boolean } {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "muraqib-script-"));
    if (options.exit !== "missing") {
      fs.mkdirSync(path.join(dir, "node_modules/.bin"), { recursive: true });
      fs.writeFileSync(path.join(dir, DEFAULT_BIN), `#!/bin/sh\necho "$@" >> "${dir}/calls.log"\nexit ${options.exit ?? 0}\n`, { mode: 0o755 });
    }
    const script = `${upsertHookBlock("#!/bin/sh\n", "pre-commit").content}echo reached > "${dir}/after.log"\n`;
    fs.writeFileSync(path.join(dir, "hook.sh"), script);
    const result = spawnSync("sh", [...(options.flags ?? []), "hook.sh", "arg1", "arg2"], {
      cwd: dir,
      encoding: "utf8",
      env: { PATH: "/usr/bin:/bin", ...options.env },
    });
    const read = (name: string): string => (fs.existsSync(path.join(dir, name)) ? fs.readFileSync(path.join(dir, name), "utf8") : "");
    return { status: result.status, calls: read("calls.log"), stderr: result.stderr, after: read("after.log") !== "" };
  }

  test("passes the hook arguments to `muraqib hook run pre-commit` and continues when it succeeds", () => {
    const result = run({ exit: 0 });
    expect(result).toMatchObject({ status: 0, calls: "hook run pre-commit arg1 arg2\n", after: true });
  });

  test("exit status 1 (findings) blocks and stops the rest of the hook", () => {
    expect(run({ exit: 1 })).toMatchObject({ status: 1, after: false });
  });

  test.each([2, 3, 127])("exit status %i (muraqib could not check) does not block", (code) => {
    expect(run({ exit: code })).toMatchObject({ status: 0, after: true });
  });

  test("the same holds when the hook runs under `sh -e` (Husky)", () => {
    expect(run({ exit: 3, flags: ["-e"] })).toMatchObject({ status: 0, after: true });
    expect(run({ exit: 1, flags: ["-e"] })).toMatchObject({ status: 1, after: false });
  });

  test("a missing muraqib binary warns and does not block", () => {
    const result = run({ exit: "missing" });
    expect(result).toMatchObject({ status: 0, after: true });
    expect(result.stderr).toContain("muraqib: not installed, skipping pre-commit check");
  });

  test(`${SKIP_ENV}=1 skips muraqib entirely`, () => {
    expect(run({ exit: 1, env: { [SKIP_ENV]: "1" } })).toMatchObject({ status: 0, calls: "", after: true });
  });
});
