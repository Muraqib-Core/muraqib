# Muraqib Core -- documentation

Unified developer environment guardian and auditor for security, performance and architecture issues in AI-generated code.

This directory is a wiki maintained by an LLM: linked markdown pages, nothing outside the
repository. The rules are in [`CLAUDE.md`](CLAUDE.md).

## Start here

1. [[install]] -- install the package
2. [[cli]] -- command line usage
3. [[cli-routing]] -- how a command reaches a guard
4. [[guards]] -- what each guard checks

---

## concepts

_None yet._

## architecture

_None yet._

## subsystems

- [[cli-routing]] -- CLI entry, routing and module map
- [[ci-commit-identity]] -- PR check that rejects Claude identity or attribution

## decisions

_None yet._

## reference

- [[cli]] -- CLI options and exit codes
- [[ai]] -- AI agent commands and API
- [[agent-v2]] -- ranked plan, verified fixes, Gemini
- [[guards]] -- guard lists and BaseGuard API
- [[webview]] -- documentation web view
- [[REFERENCE]] -- generated project reference

## operations

- [[install]] -- installation
- [[ci]] -- CI/CD workflows
- [[development]] -- local development and contributing
- [[testing]] -- running the suite, git and Windows pitfalls

## history

_None yet._

---

## Using this wiki

```
/docs-sync     right after a deploy or release -- reads only what changed since verified_at
/docs-lint     integrity check (orphans, broken links, broken sources, stale, unverified)
/docs-query    ask the docs. If it is not there, the answer says so
/docs-status   commits not yet reflected, stale pages, recent work
```

Every page carries `verified_at`, the commit it was checked against. Change code, run
`/docs-sync`.
