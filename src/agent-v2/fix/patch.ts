import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { readIfExists, resolveInside } from "./project-copy.js";

/**
 * Unified diff (git format, apply with `git apply`) between two project folders, restricted to
 * the given files. Uses `git diff --no-index`, so no diff library is needed.
 * Returns "" when nothing differs or git is unavailable.
 *
 * @param originalRoot - Project folder before the change
 * @param modifiedRoot - Project folder after the change
 * @param files - Project-relative files to compare
 * @param contextLines - Lines of context around each change; git's default (3) when omitted
 */
export function makePatch(originalRoot: string, modifiedRoot: string, files: readonly string[], contextLines?: number): string {
  const stage = mkdtempSync(join(tmpdir(), "muraqib-agent-patch-"));
  try {
    for (const file of [...files].sort()) {
      for (const [side, root] of [["a", originalRoot], ["b", modifiedRoot]] as const) {
        const content = readIfExists(root, file);
        if (content === undefined) continue;
        const target = resolveInside(join(stage, side), file);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, content, "utf-8");
      }
    }
    mkdirSync(join(stage, "a"), { recursive: true });
    mkdirSync(join(stage, "b"), { recursive: true });
    return runDiff(stage, contextLines);
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

function runDiff(cwd: string, contextLines?: number): string {
  const context = contextLines === undefined ? [] : [`-U${Math.max(0, Math.floor(contextLines))}`];
  try {
    return execFileSync("git", ["diff", "--no-index", "--no-color", "--no-prefix", ...context, "a", "b"], {
      cwd,
      encoding: "utf-8",
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch (error) {
    // `git diff --no-index` exits 1 when the folders differ; the diff is on stdout.
    const out = (error as { status?: unknown; stdout?: unknown }).stdout;
    if ((error as { status?: unknown }).status === 1 && typeof out === "string") return out;
    return "";
  }
}
