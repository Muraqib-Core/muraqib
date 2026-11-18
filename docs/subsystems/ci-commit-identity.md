---
title: Commit identity check
type: subsystem
created: 2026-11-04
updated: 2026-11-04
sources:
  - code: scripts/check-commit-identity.mjs
  - code: .github/workflows/commit-identity.yml
  - code: tests/unit/check-commit-identity.spec.ts
verified_at: f39b88d
---

# Commit identity check

Every pull request runs `scripts/check-commit-identity.mjs` over `base..head`. It fails if an
author or committer name or email matches `claude` or `anthropic.com`, or if a message
contains `Co-Authored-By: Claude`, `Claude-Session:` or `Generated with Claude Code`. This
enforces the rule in the root `CLAUDE.md` that everything pushed carries the project
owner's identity. The CLI it protects is described in [[cli-routing]].

> ⚠️ The workflow checks out the PR head SHA, not the synthetic merge commit, and needs
> `fetch-depth: 0`; otherwise the range contains the wrong commits (`.github/workflows/commit-identity.yml`).

> ⚠️ Commit `1da6354` on `main` predates this check and still has the Claude author; it
> cannot be rewritten on `main`.
