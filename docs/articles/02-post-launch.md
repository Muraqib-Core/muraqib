# Muraqib Is Live: Audit Your AI-Written Node.js Code in One Command

*A full tour of what shipped, how it works, and how to put it in your workflow today.*

---

A few weeks ago we wrote about a problem: AI assistants write code that compiles, passes tests, and still hides leaked secrets, root containers and vulnerable dependencies. Today **Muraqib is live**.

```bash
npx @muraqib/core audit
```

That is the whole install. No account, no config file, no server. Here is everything inside, in the order you will probably use it.

> **Before you publish this post:** replace the bracketed items (version, launch date, links, your own audit output) with real values. Everything else below reflects the current code.

## 1. Run your first audit

```bash
npm install -D @muraqib/core      # optional; npx works without it
npx muraqib audit                 # text report, every module
npx muraqib audit -i              # guided interactive mode
npx muraqib audit --format html -o report.html
```

Formats: `text`, `json`, `html`, `csv`, `md`. Exit codes are CI-friendly and unambiguous:

| Code | Meaning |
|---|---|
| `0` | No blocking findings |
| `1` | Blocking findings (critical/error, or warnings with `--fail-on-warning`) |
| `3` | A scanner failed, so the result is **not reliable** |
| `130` | You cancelled the interactive prompt |

That `3` is on purpose. Many tools turn "I could not check" into a green tick. Muraqib refuses to.

*[Paste a screenshot or snippet of a real audit of one of your own projects here. Real output beats any description.]*

## 2. The sixteen guards

Every check extends a single `BaseGuard` and returns the same `AuditResult` (status, module, issues, message, timestamp, duration). Each issue carries a code, a severity (`critical` / `error` / `warning` / `info`), a file and line, and a recommendation.

- **Security:** `SecurityGuard`, `SecretGuard`, `ConfigGuard`
- **Performance:** `MemoryGuard`, `BundleBudgetGuard`, `ImageGuard`, `CachePerformanceGuard`, `HttpOptimizerGuard`, `NetworkLatencyGuard`, `RenderBlockingGuard`
- **Code health:** `AsyncGuard`, `DeadCodeGuard`, `DependencyGuard`
- **Environment:** `EnvGuard`, `CompatibilityGuard`, `DockerGuard`

Run only some of them with `-m memory-guard,security-guard`. A guard that has nothing to measure says so. It reports a `CHECK_SKIPPED` info issue instead of a fake pass.

Writing your own is one class:

```typescript
import { BaseGuard } from '@muraqib/core';
import type { AuditResult } from '@muraqib/core';

class NoTodoGuard extends BaseGuard {
  constructor(context?: AuditContext) { super('no-todo-guard', context); }

  async execute(): Promise<AuditResult> {
    const issue = this.createIssue(
      'TODO_001', 'warning', 'TODO left in code',
      'Production code should not contain open TODOs.',
      { file: 'src/app.ts', line: 42 },
      'Resolve it or track it in an issue.'
    );
    return this.issues([issue], 'Found issues');
  }
}
```

## 3. The scan layer: dependencies, Docker, and beyond

Add `--osv`, `--docker` or `--ai-advisory` and a second engine merges its findings into the same report:

- **`--osv`** checks dependencies against OSV. The endpoint and timeout are overridable (`OSV_API_URL`, `OSV_TIMEOUT`), and responses are capped at 5 MiB while streaming.
- **`--docker`** analyses Dockerfile, Compose and `.dockerignore` rules.
- **`muraqib image --image my-app:latest`** scans a local image through Trivy.
- **`muraqib runtime --container my-app`** inspects a running container read-only. It never starts, stops or modifies it.
- **`muraqib resolve`** is the one command that can change your project, and it is paranoid about it: evidence-based plan, explicit approval, verification, automatic rollback on failure.

Environment policy matters too. With `-e prod`, medium-severity scan findings *block*; with `build`, high and critical ones do.

## 4. Environment validation that does not cry wolf

Muraqib validates `.env` files and `process.env` against presets using **Zod** (built in), or **Valibot** / **ArkType** as optional peer dependencies. A large part of the work before launch was killing false positives: `PORT` now accepts 80 and 443, `DATABASE_URL` accepts MySQL, MongoDB and file schemes instead of PostgreSQL only, and `AWS_REGION` accepts `us-gov-*`.

The `.env` parser follows real dotenv semantics: multi-line quoted values (PEM keys), `export` prefixes, `${VAR:-default}` fallbacks, `\$` escapes, `#` as a comment only after whitespace so `pa#ss` survives, and a self-reference like `PATH=$PATH:/x` that uses the real value instead of looping forever.

One deliberate behaviour change: a `.env` file no longer overrides a variable that is already set in the real environment, because that is what production does. Pass `override: true` if you want the old behaviour.

## 5. Stop secrets at the commit

```bash
muraqib hook install              # pre-commit: scan staged lines only
muraqib hook install --pre-push   # opt in: security audit before every push
muraqib hook uninstall
```

Only added lines are scanned, in well under a second. Real credentials (Stripe, GitHub, AWS, Slack, `sk-` keys, private keys including PKCS#8 and OpenSSH headers) block the commit. Weaker matches warn. Secrets are masked in the output. False positive? Put `muraqib-ignore-secret` on the line, use `git commit --no-verify`, or set `MURAQIB_SKIP_HOOKS=1`.

Your existing hooks are safe: Muraqib appends one marked block, respects `core.hooksPath` and Husky, and `uninstall` restores the file byte for byte. A crash never blocks git.

## 6. Hand it to your AI assistant

```bash
muraqib agent -p ./my-app --osv --max-issues 50
muraqib context        # capabilities, modules, severity semantics
muraqib tool-schema    # tool definitions for MCP / tool-use clients
```

The `AgentReport` is versioned (`schemaVersion: "1.0"`) and deterministic, with issues sorted by severity and **stable issue IDs**. So the workflow is:

1. The agent runs `muraqib agent`.
2. It fixes issues.
3. It re-runs `muraqib agent`.
4. Fixed issues have *disappeared by ID*, which is proof rather than a claim.

Programmatically:

```typescript
import { runAuditForAgent } from '@muraqib/core';

const report = await runAuditForAgent({ projectRoot: process.cwd(), osv: true, maxIssues: 50 });
// { ok, verdict: 'pass' | 'fail', summary, modules, issues[], truncated }
```

It never throws and never prints. If the audit cannot run, you get `{ ok: false, error }`.

## 7. A scorecard for your README and your CI

```bash
muraqib audit --report -o "$GITHUB_STEP_SUMMARY"
```

Start at 100. Subtract 25 per critical, 10 per high, 4 per medium, 1 per low. Any critical finding caps the total at 59. Grades: A ≥ 90, B ≥ 80, C ≥ 70, D ≥ 60, F below. Modules you did not run do not affect the score, and the report tells you which ones were evaluated, so run the full audit before you screenshot a number.

A minimal GitHub Actions step:

```yaml
- run: npx @muraqib/core audit --no-interactive --fail-on-warning --report -o "$GITHUB_STEP_SUMMARY"
```

## 8. In your editor

The VS Code extension runs the same engine: **Muraqib: Run Audit**, **Show Documentation** and **Show Last Report**. Findings fill the Problems panel and a status-bar counter; the report view groups by severity and module, includes scanner coverage, and works in Arabic and RTL. Settings live under `muraqib.*` (modules, OSV, Docker, security URL, fail-on-warning, max issues).

Security is built in rather than bolted on: strict CSP (`default-src 'none'`, nonce-only script and style), every dynamic string escaped, every webview message validated, and "open file at line" restricted to existing regular files inside the workspace after resolving `..` and symlinks. The AI advisory is intentionally not exposed in the extension because it would send project data off your machine.

*[Add the Marketplace / Open VSX link here once the extension tag is published.]*

## 9. How we kept ourselves honest

- Strict TypeScript, no `any`.
- **1,708 tests across 120 files**, all passing, with an 85% coverage threshold enforced in CI.
- CI on Node 20.12 and 22 behind a quality gate: lint, build, tests, **self-audit** (Muraqib audits Muraqib), package-contents check, security scan, extension checks and a generated-docs check.
- Documentation derived from source, so a stale README fails the build.
- Releases verify that the git tag matches `package.json` before publishing to npm with provenance.

The honest failure stories shaped it most. Our dead-code guard once skipped its *own source* because the ignore marker appeared inside a string literal. Our render-blocking check was matching substrings until a minified `<head lang="en">` fooled it; it now reads real tag attributes. Our compatibility check treated `next@14.10` as `14.1` until we switched to proper `semver`. Each one is fixed, tested, and in the changelog.

## 10. What is next

[Fill in your real roadmap here. Ideas grounded in the codebase: more guards, more scan engines, Open VSX publication for the extension, deeper agent integrations.]

## Try it, and tell us what it missed

```bash
npx @muraqib/core audit -i
```

- GitHub: https://github.com/Muraqib-Core/muraqib
- npm: https://www.npmjs.com/package/@muraqib/core
- Found a false positive, or something Muraqib *should* have caught? Open an issue. Those reports are the most valuable thing you can give us.

If this saves you from shipping one leaked key, it has done its job.

**Aya Almadhon & Jenan** · Muraqib Core
