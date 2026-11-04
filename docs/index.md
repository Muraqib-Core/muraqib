# Muraqib Core -- documentation

Unified developer environment guardian and auditor for security, performance and architecture issues in AI-generated code.

This directory is a wiki maintained by an LLM: linked markdown pages, nothing outside the
repository. The rules are in [`CLAUDE.md`](CLAUDE.md).

## Start here

1. [[cli]] -- how a command reaches a guard

---

## concepts

<!-- TODO: pages under Domain and product concepts. Mostly survive code changes. `- [[page-name]] -- one line` -->

## architecture

<!-- TODO: pages under System structure, data model, main flows. `- [[page-name]] -- one line` -->

## subsystems

- [[cli]] -- CLI entry, routing and module map
- [[ci-commit-identity]] -- PR check that rejects Claude identity or attribution

## decisions

<!-- TODO: pages under Why it was decided that way (ADRs, known defects). `- [[page-name]] -- one line` -->

## reference

<!-- TODO: pages under Schemas, APIs, env vars -- documents you look values up in. `- [[page-name]] -- one line` -->

## operations

<!-- TODO: pages under Install, deploy, checks, incident response. `- [[page-name]] -- one line` -->

## history

<!-- TODO: pages under Development history, lessons, migrated records. `- [[page-name]] -- one line` -->

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
