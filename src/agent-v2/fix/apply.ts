import { execFileSync } from "node:child_process";

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
}

/** Outcome of {@link createFixBranch}: the new branch and the one left behind, or why apply mode cannot start. */
export type BranchResult = { ok: true; branch: string; previous: string } | { ok: false; reason: string };

/**
 * Apply mode safety: needs a git repository with a clean working tree, then switches to a new
 * branch `agent/fix-<timestamp>` so every change can be reviewed or thrown away with the branch.
 */
export function createFixBranch(projectRoot: string, now: Date = new Date()): BranchResult {
  try {
    git(projectRoot, ["rev-parse", "--is-inside-work-tree"]);
  } catch {
    return { ok: false, reason: "apply mode needs a git repository (nothing was changed)" };
  }
  try {
    if (git(projectRoot, ["status", "--porcelain"]).trim() !== "") {
      return { ok: false, reason: "the working tree has uncommitted changes; commit or stash them first (nothing was changed)" };
    }
    const previous = git(projectRoot, ["rev-parse", "--abbrev-ref", "HEAD"]).trim();
    const stamp = now.toISOString().replace(/[-:T]/g, "").slice(0, 14);
    const branch = `agent/fix-${stamp}`;
    git(projectRoot, ["switch", "-c", branch]);
    return { ok: true, branch, previous };
  } catch (error) {
    return { ok: false, reason: `could not create a branch: ${error instanceof Error ? error.message.split("\n")[0] ?? "git error" : "git error"}` };
  }
}
