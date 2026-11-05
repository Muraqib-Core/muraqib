---
title: Git hooks installation
type: subsystem
created: 2026-11-05
updated: 2026-11-05
sources:
  - code: src/hooks/install.ts
  - code: src/hooks/cli.ts
  - code: tests/unit/hooks/install.spec.ts
verified_at: d5ddf18
---

# Git hooks installation

`muraqib hook install` and `uninstall` (`src/hooks/cli.ts`) write the pre-commit hook, and the opt-in pre-push hook with `--pre-push`, into the right hooks directory. `resolveHooksLocation` in `src/hooks/install.ts` finds that directory from the repository the command runs in.

## Where hooks go

1. The repository root comes from `git rev-parse --show-toplevel`.
2. If `core.hooksPath` is set, it is resolved against the root. Husky v9 (`.husky/_`) resolves to the editable `.husky` folder instead of the generated one.
3. Otherwise the default is the `hooks` folder under the git common directory, so linked worktrees share the main repository's hooks.

The result is `{ gitRoot, dir, kind }` with `kind` one of `git`, `hooksPath` or `husky`. Running outside a repository throws "Not a git repository".

> ⚠️ git prints the repository root with forward slashes even on Windows, while `dir` is built with `path.resolve`. `resolveHooksLocation` passes the root through `path.resolve` so both fields use the platform's separator; without that, Windows callers see a mixed-separator result and equality checks fail (`src/hooks/install.ts`).

> ⚠️ Tests that expect "Not a git repository" only hold when no parent of the temp directory is a repository; see [[testing]] for the git ceiling that guarantees it.
