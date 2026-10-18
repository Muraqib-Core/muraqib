# AI Writes Your Code Faster Than You Can Read It. Who Audits It?

*Muraqib is a read-only guardian for Node.js and TypeScript projects. It goes live soon. Here is why we built it and what it does.*

---

Last month an AI assistant wrote me a perfectly reasonable Express endpoint. It compiled. The tests passed. The `.env.example` had a real-looking API key in it, the Dockerfile ran as root, and a dependency three levels deep had a known CVE.

Nothing was *broken*. That is the problem.

AI-generated code fails quietly. It is syntactically clean and confidently wrong in the places you do not look: secrets, configuration, dependencies, container setup, performance budgets. A linter will not catch these, because they are not style problems. A code review will not catch them, because the diff is 600 lines and arrived in 20 seconds.

We are Aya Almadhon and Jenan, and for the past few weeks we have been building the tool we wanted at that moment. It is called **Muraqib** (مراقب, Arabic for *monitor* or *observer*), and it is about to go live.

## What Muraqib is

Muraqib is an audit engine for Node.js and TypeScript projects. You point it at a project and it reports security, performance, dependency, Docker and configuration problems as structured, severity-ranked findings.

```bash
npx @muraqib/core audit
```

Two design decisions define everything else:

1. **It is read-only.** Muraqib reports. It never edits your code. The only command that touches your files is `resolve`, and that one shows you a plan, asks for approval, verifies the result and rolls back on failure.
2. **It is complementary to AI, not a competitor.** The output is built to be read by humans *and* by the AI assistant that wrote the code in the first place.

## Sixteen guards, one model

Every check in Muraqib is a *guard*, a class that extends a single abstract `BaseGuard` and returns the same `AuditResult`. Sixteen ship in the box:

| Area | Guards |
|---|---|
| **Security** | `SecurityGuard` (probes a URL for missing security headers and common web vulnerabilities), `SecretGuard`, `ConfigGuard` |
| **Performance** | `MemoryGuard`, `BundleBudgetGuard` (14 KB first-round-trip budget), `ImageGuard`, `CachePerformanceGuard`, `HttpOptimizerGuard`, `NetworkLatencyGuard`, `RenderBlockingGuard` |
| **Code health** | `AsyncGuard` (floating promises, missing `await`), `DeadCodeGuard`, `DependencyGuard` (circular imports, duplicates, outdated packages) |
| **Environment** | `EnvGuard`, `CompatibilityGuard` (Node engine ranges, EOL runtimes, peer deps), `DockerGuard` |

Because every guard speaks the same language (`critical`, `error`, `warning`, `info`, with a code, a location, and a recommended fix), adding a seventeenth guard is a matter of implementing one `execute()` method.

On top of the guards sits a second layer, the **scan layer**:

- **`--osv`** checks your dependencies against the [OSV](https://osv.dev) vulnerability database.
- **`--docker`** discovers and analyses your Dockerfile and Compose files.
- **`muraqib image`** scans a local Docker image with Trivy.
- **`muraqib runtime`** inspects a *running* container, read-only.
- **`muraqib resolve`** builds an evidence-based dependency resolution plan from OSV data.

## The part we are proudest of: it talks to AI agents

Most dev tools print pretty terminal output and stop there. Muraqib has a second front door for LLM agents (Claude Code, Cursor, any MCP-style client):

```bash
muraqib agent -p ./my-app --osv --max-issues 50
```

The result is a versioned JSON report (`schemaVersion: "1.0"`) that is **deterministic**: no timestamps, no durations, issues sorted by severity, and every issue has a *stable ID*. That last detail matters more than it sounds. It lets an agent fix a problem, re-run the audit, and *prove* the issue is gone by checking that its ID disappeared. The loop closes without a human in the middle.

`muraqib tool-schema` prints tool definitions an agent framework can register directly, and `runAuditForAgent()` never throws or prints, so embedding it is safe.

And if you prefer to stay in the loop yourself, `muraqib audit -i` opens a guided interactive mode that ends with a paste-ready prompt you can hand to your AI assistant, ending with the exact command it should run to re-check its work.

## Stopping secrets before they leave your laptop

```bash
muraqib hook install
```

This installs a pre-commit hook that scans **only the lines your commit adds**, not your whole history, and finishes in well under a second. It blocks the commit only for credentials that are almost certainly real: live Stripe, GitHub, AWS and Slack tokens, `sk-` keys, private keys, real values in a staged `.env`. Weaker matches such as publishable keys or `password = "..."` are warnings that never block.

We obsessed over not being annoying:

- It **never replaces your existing hooks**. It adds one marked block, and `uninstall` removes exactly that block, byte for byte.
- It respects `core.hooksPath` and Husky.
- A crash, a missing binary or an unreadable index prints a warning and lets git continue. **A broken hook never traps you.**

## A score you can put in your README

`muraqib audit --report` produces a Markdown security scorecard with a 0-100 score and a badge. The formula is deliberately simple and fully deterministic: start at 100 and subtract 25 per critical finding, 10 per high, 4 per medium, 1 per low. Any critical finding hard-caps the score at 59, a grade F, however clean everything else is. Same findings, same score, every time. You can paste it into a README or write it straight to `$GITHUB_STEP_SUMMARY` in CI.

## Built the way we are asking you to build

It would be hypocritical to ship an auditor that is itself unaudited. So:

- **Strict TypeScript** with no `any`, plus ESLint.
- **1,708 passing tests** across 120 files, with an 85% coverage threshold enforced in CI.
- CI runs on Node 20.12 and 22, and a **quality gate** blocks merges unless lint, build, tests, a **self-audit** (Muraqib audits Muraqib), package-contents checks, a security scan and generated-docs checks all pass.
- The documentation is **generated from the source**. Guards, CLI flags, scripts and workflows in the README come from the code, and CI fails if they drift.
- Releases are published to npm with provenance.

Privacy is handled the same way. The optional AI advisory (Gemini, opt-in, needs your own key) redacts secrets before anything is sent, and in the VS Code extension it is deliberately not exposed at all.

## And a VS Code extension

The same engine is available inside VS Code: findings land in the **Problems** panel, a status-bar counter shows the total, and a report view groups issues by severity and module. It supports Arabic and right-to-left layouts, runs under a strict Content-Security-Policy, and only opens files that sit inside your workspace.

## Why now, and what is next

AI coding tools are not going away, and they are only going to write *more* of our code. The answer is not to trust them less. It is to verify better, with something fast, deterministic and honest about what it could and could not check. (If a scanner fails, Muraqib exits with code `3` and says the result is not reliable, rather than pretending everything is green.)

We are launching soon. If you want to be there on day one:

- **Star the repo:** https://github.com/Muraqib-Core/muraqib
- **Follow us here on Medium** so the launch post lands in your feed.
- **Tell us what you would want it to catch.** The most useful thing you can do before launch is open an issue with the worst thing an AI ever slipped past your review.

*In the launch post, we will walk through a real audit end to end.*

**Aya Almadhon & Jenan** · Muraqib Core
