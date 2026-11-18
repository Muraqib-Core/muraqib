---
title: CLI entry and command routing
type: subsystem
created: 2026-11-04
updated: 2026-11-04
sources:
  - code: src/cli/index.ts
  - code: src/cli/commands.ts
  - code: src/cli/args.ts
  - code: src/cli/audit-report.ts
  - code: tests/unit/cli/lazy-ui.spec.ts
verified_at: f39b88d
---

# CLI entry and command routing

`runCli` in `src/cli/index.ts` is a thin router. It picks one of four paths and does no
auditing itself. The bulk of the logic lives in sibling modules that were split out of the
old single file.

## Routing order

1. `resolve`, `image`, `runtime` go to `runScanLayer` in `src/cli/commands.ts`.
2. `hook` is imported on demand from `src/hooks/cli.ts`, so git hooks start fast.
3. Any `--skip-*` flag or one of `--url`, `--path`, `--upgrade`, `--safe`, `--presets`,
   `--schedule`, `--silent` hands off to the workflow runner `src/cli/audit-cli.ts`.
4. Everything else is parsed by `parseArgs` (`src/cli/args.ts`), the project root is
   resolved, and `runCommand` dispatches `audit`, `agent`, `context`, `tool-schema` and the
   interactive mode.

## Module map

| File | Owns |
|---|---|
| `src/cli/index.ts` | routing, entry block, public re-exports |
| `src/cli/args.ts` | flag table, `parseArgs`, `resolveProjectRoot` |
| `src/cli/commands.ts` | `runScanLayer`, `runCommand` and its runners |
| `src/cli/audit-report.ts` | `createAuditReport` |

Related: [[ci-commit-identity]] guards how changes to this subsystem reach `main`.

> ⚠️ The interactive UI must stay lazy. `tests/unit/cli/lazy-ui.spec.ts` reads the source of
> `src/cli/index.ts` and requires the literal `import("./interactive.js")` there, so the
> dynamic import cannot move into `src/cli/commands.ts`. It is passed to `runCommand` as a loader.

> ⚠️ Set `process.exitCode`, never call `process.exit()`. Exiting truncates large piped
> stdout at the 64KB pipe buffer (`src/cli/index.ts` entry block).

> ⚠️ `src/index.ts` does `export * from "./cli/index.js"`, so `formatReport`,
> `createAuditReport` and the option types must remain re-exported from `src/cli/index.ts`.
