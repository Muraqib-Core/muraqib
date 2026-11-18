---
title: Running the test suite
type: operation
created: 2026-11-05
updated: 2026-11-05
sources:
  - code: vitest.config.ts
  - code: tests/setup-git-ceiling.ts
  - code: tests/unit/symlink-support.ts
  - code: tests/unit/hooks/git-fixture.ts
verified_at: 12c6866
---

# Running the test suite

`npm test` runs Vitest over `tests/**/*.spec.ts`. Coverage thresholds are 85% for lines, functions, branches and statements (`vitest.config.ts`). Linux and macOS need nothing special; the notes below are for Windows and unusual machines.

## Git-based tests need a clean temp directory

Many specs create throwaway repositories, or deliberately non-repositories, under the OS temp directory. `tests/setup-git-ceiling.ts` sets `GIT_CEILING_DIRECTORIES` to that directory so git never discovers a repository above it.

> ⚠️ If a parent of the temp directory is a git repository (for example someone ran `git init` in their home folder), git finds it and about 30 tests fail in confusing ways: "Not a git repository" does not throw, `git apply` silently changes nothing, and fixes report "uncommitted changes". The ceiling in `tests/setup-git-ceiling.ts` is what prevents this; do not remove it.

> ⚠️ Isolate git config with an empty file, not `os.devNull`. Git for Windows fails with `unable to access '\\.\nul'` when `GIT_CONFIG_GLOBAL` points at the null device (`tests/unit/hooks/git-fixture.ts`).

## Symlink tests

Creating symlinks on Windows needs Developer Mode or an elevated shell. `tests/unit/symlink-support.ts` probes this once, and symlink specs use `it.skipIf(!canSymlink)`, so they are skipped (not failed) where symlinks are unavailable.

## Windows differences the specs account for

- `runCommand` in `src/core/upgrade-orchestrator.ts` launches `npm.cmd`, `npx.cmd` and `pnpm.cmd`; specs compare the tool name without the `.cmd` suffix.
- git reports forward-slash paths even on Windows, so path assertions normalise separators.
- `scanProjectFiles` returns forward-slash relative paths on every platform (`src/utils/file-scanner.ts`).
- The default test timeout is 20 s because process spawning is several times slower on Windows.
