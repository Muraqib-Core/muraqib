/**
 * Git protection helpers for environment file scanning.
 * Extracted to reduce config-guard.ts bundle size.
 */

import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";

export function runGit(args: string[], cwd: string): { status: number | null; stdout: string } {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
  return { status: result.error ? null : result.status, stdout: result.stdout ?? "" };
}

export function globToRegExp(glob: string): RegExp {
  let source = "";
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i] ?? "";
    if (ch === "*") {
      if (glob[i + 1] === "*") {
        if (glob[i + 2] === "/") {
          source += "(?:.*/)?";
          i += 2;
        } else {
          source += ".*";
          i += 1;
        }
      } else {
        source += "[^/]*";
      }
    } else if (ch === "?") {
      source += "[^/]";
    } else {
      source += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${source}$`);
}

export function isIgnoredByGitignoreFile(_root: string, relativePath: string, gitignorePath: string): boolean {
  let content: string;
  try {
    content = fs.readFileSync(gitignorePath, "utf-8");
  } catch {
    return false;
  }

  let ignored = false;
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;

    const negated = line.startsWith("!");
    let pattern = (negated ? line.slice(1) : line).replace(/\/+$/, "");
    const anchored = pattern.includes("/");
    pattern = pattern.replace(/^\/+/, "");
    if (pattern === "") continue;

    const subject = anchored ? relativePath : path.posix.basename(relativePath);
    if (globToRegExp(pattern).test(subject)) {
      ignored = !negated;
    }
  }
  return ignored;
}

export function isGitIgnored(root: string, relativePath: string): boolean {
  const { status } = runGit(["check-ignore", "-q", "--no-index", "--", relativePath], root);
  if (status === 0) return true;
  if (status === 1) return false;
  return isIgnoredByGitignoreFile(root, relativePath, path.join(root, ".gitignore"));
}

export function trackedEnvFiles(root: string, envFilePattern: RegExp, envTemplatePattern: RegExp): string[] {
  const { status, stdout } = runGit(["ls-files", "-z"], root);
  if (status !== 0) return [];
  return stdout
    .split("\0")
    .filter((file: string) => file !== "")
    .filter((file: string) => {
      const base = path.posix.basename(file);
      return envFilePattern.test(base) && !envTemplatePattern.test(base);
    });
}
