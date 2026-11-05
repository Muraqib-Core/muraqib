import fs from "node:fs";
import os from "node:os";

// Tests create throwaway repositories (or deliberately non-repositories) under the temp directory.
// If a parent of that directory is itself a git repository (for example a home folder someone ran
// `git init` in), git would discover it and every "outside a git repository" test would misbehave.
// A ceiling directory stops git's upward search at the temp directory.
const ceiling = fs.realpathSync(os.tmpdir());
const existing = process.env["GIT_CEILING_DIRECTORIES"];
process.env["GIT_CEILING_DIRECTORIES"] = existing === undefined || existing === "" ? ceiling : `${ceiling}${process.platform === "win32" ? ";" : ":"}${existing}`;
