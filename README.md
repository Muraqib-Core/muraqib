<div align="center">

#  @muraqib/core

**Unified Developer Environment Guardian & Performance Auditor**

Comprehensive audit framework for Node.js/TypeScript projects. Detects security vulnerabilities, performance issues, architecture violations, and configuration problems in code.

<!-- AUTO:badges:start -->
[![TypeScript](https://img.shields.io/badge/TypeScript-6.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20.12+-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Vitest](https://img.shields.io/badge/Vitest-5.x-729B1B?logo=vitest&logoColor=white)](https://vitest.dev)
[![CI/CD](https://img.shields.io/github/actions/workflow/status/Muraqib-Core/muraqib/ci.yml?branch=main&label=CI%2FCD&logo=github)](https://github.com/Muraqib-Core/muraqib/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/License-ISC-yellow.svg)](LICENSE)
<!-- AUTO:badges:end -->

</div>

---

##  Features

###  Security Auditing
- **Injection Prevention**: SQL/XSS detection and prevention
- **Secret Detection**: API keys, passwords, tokens, credentials
- **Auth/Crypto Validation**: Security protocols and cryptographic best practices
- **Security Headers Analysis**: HTTP security header validation

###  Performance (13+ Modules)
- **Memory Management**: Heap leak detection and memory profile analysis
- **Bundle Optimization**: Size monitoring and budget enforcement (14 KB default)
- **Network Analysis**: Latency measurement and optimization recommendations
- **Dead Code Detection**: Unreachable code and unused exports
- **Dependency Analysis**: Circular dependencies and duplication detection
- **Async Patterns**: Floating promises and missing await validation
- **Cache Strategy**: Performance optimization and caching recommendations
- **Image Optimization**: Image size analysis and format recommendations
- **Render Blocking**: Render-blocking resource detection
- **HTTP/2 Support**: Protocol and compression optimization

###  Architecture Validation
- **Configuration Validation**: Environment variables and config file validation
- **Docker Best Practices**: Containerization checks and recommendations
- **Compatibility Checking**: Node.js version and peer dependency validation
- **AI-Powered Recommendations**: Context-aware issue resolution suggestions

###  AI Integration
- **AI-Complementary**: Works with AI-generated code to catch issues
- **Secret Detection**: Advanced pattern matching for sensitive data
- **Intelligent Recommendations**: AI-powered fix suggestions

---

##  Usage from npm

The npm package is `@muraqib/core`; the CLI command it installs is `muraqib`.
The muraqib version will be available after publication:

```bash
# Full audit
npx @muraqib/core audit

# Guided interactive mode (Clack)
npx @muraqib/core audit -i

# Install locally, then use the CLI command
npm install -D @muraqib/core
npx muraqib audit
```

> After installing `@muraqib/core`, use `npx muraqib`.
> Without a local installation, use `npx @muraqib/core@beta`.

In CI, pass `--no-interactive` and use `--fail-on-warning` when warnings should block the build.
### Optional peer dependencies

The default install is lightweight. These packages are optional peer dependencies; install only what you use:

Generated from `package.json` (`peerDependencies`):

<!-- AUTO:peer-deps:start -->
| Package | Range | Kind | Install |
|---------|-------|------|---------|
| `@google/genai` | `^2.22.0` | optional | `npm i @google/genai` |
| `arktype` | `^2.2.0` | optional | `npm i arktype` |
| `valibot` | `^1.4.0` | optional | `npm i valibot` |
<!-- AUTO:peer-deps:end -->

Used for: `valibot` → `--engine valibot` / `ValibotEngine`; `arktype` → `--engine arktype` / `ArktypeEngine`; `@google/genai` → AI advisor (`--ai-advisory`, Gemini).

`zod` is installed with `@muraqib/core` because the built-in environment presets use it internally. If an optional package is missing, Muraqib fails with an actionable message such as `install valibot to use engine 'valibot'`; the AI advisor degrades gracefully (a one-time warning, audit continues). HTTP probes use the built-in `fetch`, so there is no HTTP client dependency.

---

##  Local development

```bash
# Clone the repository
git clone https://github.com/Muraqib-Core/muraqib.git
cd muraqib

# Install dependencies
npm install

# Build TypeScript
npm run build

# Run tests
npm test
```

---

##  Quick Start

```bash
# Run full audit on current project
npm run audit

# Run in demo/dry-run mode
npm run audit:demo

# Development mode with watch
npm run dev

# Run test suite
npm test

# Run tests with coverage
npm test -- --coverage

# Lint code
npm run lint

# Type check
npm run type-check
```

---

##  Documentation Web View

`npm run build` also writes a self-contained documentation page (Details, Features, Installation, Configuration, Requirements, Changelog tabs) to `dist/webview/index.html`. It has no server and no network access: open the file directly in a browser.

```bash
npm run webview   # rebuild and print the path of the page
```

To show the same page inside a VS Code webview panel, pass the nonce from your extension's CSP:

```typescript
import { getWebviewHtml } from "@muraqib/core";

panel.webview.html = getWebviewHtml(nonce);
```

A ready-made VS Code extension built on `runAuditForAgent` and `getWebviewHtml` lives in [`extension/`](extension/README.md).

The page text lives in `src/webview/content/` as typed data, so adding a tab or translating it never touches the markup. The version and the dependency list are read from `package.json` at build time.

---

##  CLI Usage

After `npm run build`, the `muraqib` binary (`bin/muraqib.js`) exposes five commands.

| Command | Purpose |
|---------|---------|
| `muraqib audit` (default) | Run the guard modules, optionally adding the scan layer (OSV, Docker, AI advisory) |
| `muraqib resolve` | Interactive, evidence-based dependency resolution with an approval step and rollback |
| `muraqib image --image <name>` | Scan an existing local Docker image with [Trivy](https://trivy.dev) (must be installed) |
| `muraqib runtime --container <name>` | Read-only inspection of a running Docker container |
| `muraqib hook install` / `uninstall` | Git hooks: block commits that stage secrets; opt-in security audit before push |

### `audit` options

```bash
muraqib audit                              # text report of every module
muraqib audit --format json                # json | text | html | csv | md
muraqib audit --format html -o report.html # write the report to a file
muraqib audit -p ./my-app                  # audit another project root
muraqib audit -m memory-guard,security-guard  # only matching modules
muraqib audit --fail-on-warning            # exit 1 on warnings too
muraqib audit --report -o "$GITHUB_STEP_SUMMARY"  # Markdown security scorecard
```

| Flag | Effect |
|------|--------|
| `--osv` | Add the scan layer: check dependencies against [OSV](https://osv.dev) for known vulnerabilities |
| `--docker` | Add the scan layer: Docker configuration discovery (Dockerfile / Compose) |
| `--ai-advisory` | Add the scan layer plus an optional AI advisory (needs `GEMINI_API_KEY`; secrets are redacted before anything is sent) |
| `-p, --project <path>` | Project root (default: current directory) |
| `-f, --format <fmt>` | `text`, `json`, `html`, `csv` or `md` (`markdown` is accepted as an alias) |
| `--report` | Shorthand for `--format md`: the security scorecard and compliance report |
| `-o, --output <path>` | Write the report to a file instead of stdout |
| `-m, --modules <list>` | Comma-separated module name filter |
| `--fail-on-warning` | Treat warnings as failures |
| `-i`, `--interactive` | Guided mode: choose what to audit, review colour-coded results, then fixes / AI hand-off / HTML report (terminal only) |
| `--no-interactive` | Disable the spinner and prompts in a terminal |
| `-v, --verbose` | Verbose logging |

#### Security scorecard (`--report` / `--format md`)

The Markdown report opens with a README-ready badge and an overall **0–100 score**, then breaks it down by severity (Critical, High, Medium, Low) and by domain (Security, Dependencies, Code Quality). Paste it into a README or write it to `$GITHUB_STEP_SUMMARY` in CI. The score is a pure function of the findings, so the same report always yields the same score:

- Starting from 100, each finding subtracts 25 (critical), 10 (high), 4 (medium) or 1 (low); the score never goes below 0. Informational findings are listed but not scored.
- **Hard cap:** any critical finding limits the overall score to **59** (grade F), however little else is wrong.
- Grades: A ≥ 90, B ≥ 80, C ≥ 70, D ≥ 60, F below 60.
- Guard `error` findings count as high and `warning` as medium; the scan layer's own five-level severity is used as reported. Findings from `security-guard`, scan findings in the `security` category count as Security; package, image and compatibility findings count as Dependencies; everything else counts as Code Quality.
- The report lists which modules were evaluated: modules that were not run do not affect the score, so run the full audit for a meaningful number. The score does not change the exit code.

The same logic is available programmatically as `calculateScorecard()` and `formatMarkdown()`.

Any of `--osv`, `--docker` or `--ai-advisory` switches on the scan layer; its findings are merged into the same report. The unified report includes `exitCode` and `modules.scan.scan`, which retains the scan policy, blocking decision and per-scanner coverage (`status`, scanned/skipped inputs and diagnostics). Text, HTML, CSV and interactive reports display these coverage details too. `-e prod` blocks medium scan findings even though their displayed severity stays `warning`; `build` blocks high and critical findings. A scanner failure takes precedence and returns exit code `3`. Agent module summaries also retain scan metadata; scanner failures set `ok: false`, `verdict: "fail"` and `exitCode: 3`. The OSV endpoint and timeout can be overridden with `OSV_API_URL` and `OSV_TIMEOUT` (ms).

### `hook`: catch secrets before they are committed

```bash
muraqib hook install              # pre-commit: scan the staged changes for secrets
muraqib hook install --pre-push   # also run the security audit before every push (opt-in)
muraqib hook uninstall            # remove Muraqib's blocks (--pre-push: only the pre-push one)
```

- **Only staged content is scanned.** The pre-commit hook reads `git diff --cached` and inspects just the lines the commit adds, so the working tree and secrets committed long ago never get in the way. It runs in well under a second and exits `1` (blocking the commit) only for credentials that are almost certainly real: live Stripe/GitHub/AWS/Slack/`sk-` tokens, private keys, real values in a staged `.env`, and so on. Weaker or public-by-design matches (publishable keys, JWTs, `password = "..."`) are printed as warnings and never block. Secrets are masked in the output.
- **False positive?** Add `muraqib-ignore-secret` to the line, bypass once with `git commit --no-verify`, or set `MURAQIB_SKIP_HOOKS=1`.
- **Pre-push** (opt-in) runs the security audit: leaked or tracked secrets in env files (config-guard) plus the scan layer (OSV vulnerabilities, Docker, env validation). Critical/error security findings block the push; other config hygiene and warnings are only counted. If a scanner cannot finish (for example offline) and nothing else blocks, it warns and lets the push through.
- **Your existing hooks are safe.** Install never replaces a hook file: it adds one block between `# >>> muraqib <hook> >>>` and `# <<< muraqib <hook> <<<` markers (after the shebang, so a trailing `exec` cannot skip it), and uninstall removes exactly that block, restoring the file byte for byte. `core.hooksPath` is honoured, and with Husky the block goes into the editable `.husky/<hook>` file rather than the generated `.husky/_` stubs. A hook written in a non-shell language is left alone with a message.
- **A broken hook never traps you.** Only findings block. A missing Muraqib binary, an unreadable index or a crash prints a warning and lets the git operation continue.

### `resolve`

```bash
muraqib resolve            # run inside the project you want to resolve
muraqib -p ./my-app resolve
```

Builds a resolution plan from OSV evidence, shows it for approval, applies it, verifies the result and rolls back on failure. Put `-p` **before** `resolve`; `resolve` itself takes no other flags.

### `image` and `runtime`

```bash
muraqib image --image my-app:latest [--json]
muraqib runtime --container my-app [--json]
```

`image` requires the `trivy` binary and only scans images that already exist locally. `runtime` inspects the container read-only; it never starts, stops or modifies it.

###  AI agents (Claude Code, Cursor, MCP clients)

Muraqib is usable as a tool by LLM agents. The agent output is a versioned (`schemaVersion: "1.0"`), deterministic JSON report: no timestamps or durations, issues sorted by severity, and stable issue `id`s so an agent can confirm a fix by re-running.

```bash
muraqib agent -p ./my-app --osv --max-issues 50   # AgentReport as JSON; exit 1 on blocking findings, 3 on scanner failure
muraqib context                                    # capabilities, modules, severity semantics
muraqib tool-schema                                # tool definitions (MCP / tool-use compatible)
muraqib audit --json                               # classic report as JSON (shorthand for --format json)
```

Programmatic use:

```typescript
import { runAuditForAgent, getSystemContext, AGENT_TOOL_DEFINITIONS, executeAgentTool } from "@muraqib/core";

const report = await runAuditForAgent({ projectRoot: process.cwd(), osv: true, maxIssues: 50 });
// { ok, verdict: "pass" | "fail", summary, modules, issues[], truncated }

await executeAgentTool("muraqib_audit", { projectRoot: "/app" }); // tool-call dispatcher
```

`runAuditForAgent` never throws or prints: if the audit cannot run it returns `{ ok: false, error }`. The engine has no dependency on the CLI renderers, so a VS Code extension can call the same API.

### Interactive mode

In a terminal, `muraqib audit` shows a Clack spinner and a pass/fail summary. Add `-i` for the guided flow:

1. **What to audit**: pick categories (Full, Security, Performance & images, Configuration, Code health). Skipped when you pass `-m`.
2. **Security URL**: asked only when the security module is included; leave it empty to skip.
3. **Optional scans**: OSV, Docker, AI advisory (skipped when you pass `--osv`/`--docker`/`--ai-advisory`).
4. **Results**: a colour-coded overview, per-module issues with file, line and fix, and prioritised next steps.
5. **Follow-ups** (repeated until you pick *Finish*): recommended fixes (de-duplicated, most severe first), every issue, a paste-ready prompt for an AI assistant (ends with the `muraqib agent` re-check command), or save an HTML report.

The exit code is the same as in non-interactive runs (`1` on critical/error, `130` if you cancel). If `-i` is used where no terminal is available it prints a one-line note and runs normally. Interactive output is turned off automatically for `--json`/`--format`, `--output`, piped output and CI (`CI=true`), so machine-readable output is never polluted. Use `--no-interactive` to force it off.

### Exit codes

| Code | Meaning |
|------|---------|
| `0` | No blocking findings |
| `1` | Blocking findings (critical/error; warnings too with `--fail-on-warning`) |
| `3` | A scanner failed, so the result is not reliable |
| `130` | Interactive prompt cancelled by the user |

---

##  Architecture Overview

### Core Components

#### BaseGuard (Abstract Base Class)
The foundation for all audit modules. Each guard specializes in one audit category:

```typescript
import { BaseGuard, AuditContext, AuditResult } from '@muraqib/core';

class CustomGuard extends BaseGuard {
  constructor(context?: AuditContext) {
    super('custom-guard', context);
  }

  async execute(): Promise<AuditResult> {
    // Implement audit logic
    const issue = this.createIssue(
      'CUSTOM_001',
      'warning',
      'Issue Title',
      'Issue description',
      { file: 'src/app.ts', line: 42 },
      'How to fix this'
    );
    
    return this.issues([issue], 'Found issues');
  }
}

const guard = new CustomGuard({ projectRoot: process.cwd() });
const result = await guard.run();
```

#### Built-in Guards

Generated from every class that `extends BaseGuard` (the purpose comes from its JSDoc):

<!-- AUTO:guards:start -->
| Guard | Source | Purpose |
|-------|--------|---------|
| `AsyncGuard` | `src/core/async-guard.ts` | Detects floating promises, missing `await`, and callback-hell patterns in source files. Severity levels used: warning, error. |
| `BundleBudgetGuard` | `src/rules/bundle-budget-guard.ts` | Checks source files against the 14 KB first-round-trip budget. Severity levels used: warning. A project with no measurable source files is reported as skipped, never as a pass. |
| `CachePerformanceGuard` | `src/core/performance/cache-performance-guard.ts` | Checks the cache max-age and compression settings read from the environment. Severity levels used: warning. |
| `CompatibilityGuard` | `src/core/compatibility-guard.ts` | Validates dependency compatibility: Node.js engine ranges, end-of-life runtimes and peer dependencies. Severity levels used: error. |
| `ConfigGuard` | `src/core/config-guard.ts` | Validates configuration and environment files: missing or invalid variables and unsafe settings. Severity levels used: critical, error, warning, info (config `low` maps to info). |
| `DeadCodeGuard` | `src/rules/dead-code-guard.ts` | Dead code guard class. Detects empty functions, unreachable branches and unused exports. Severity levels used: warning. |
| `DependencyGuard` | `src/core/dependency-guard.ts` | Analyses dependencies for circular imports, duplicate and outdated packages, and deprecated APIs. Severity levels used: warning, error. |
| `DockerGuard` | `src/core/docker-guard.ts` | Guard-layer adapter over the scan layer's DockerScanner (Dockerfile, compose, .dockerignore rules). Replaces the earlier naive string-matching implementation. |
| `EnvGuard` | `src/core/env-guard.ts` | Validates the process environment (DATABASE_URL, PORT, cache settings and any presets) with the env engine. Severity levels used: error. |
| `HttpOptimizerGuard` | `src/core/performance/http-optimizer-guard.ts` | Probes a live URL for its HTTP protocol and cookie size and weighs them against the project's resource count. Severity levels used: warning (an unreachable URL is reported as an error, never as a pass). |
| `ImageGuard` | `src/core/performance/image-guard.ts` | Audits image assets for oversized files and non-optimal formats. Severity levels used: warning. |
| `MemoryGuard` | `src/core/memory-guard.ts` | Inspects heap, RSS and external memory usage and flags leak risk against configurable thresholds. Severity levels used: warning, critical, error. |
| `NetworkLatencyGuard` | `src/core/performance/network-latency-advisor.ts` | NetworkLatencyGuard - measures real response latency and first-payload size of a URL. |
| `RenderBlockingGuard` | `src/core/performance/render-blocking-guard.ts` | Checks the project's root index.html for scripts and stylesheets in `<head>` that block rendering. Severity levels used: error (synchronous script), warning (stylesheet). No index.html means skipped. |
| `SecretGuard` | `src/core/secret-guard.ts` | Detects secrets in added lines and reports them as {@link AuditIssue}s (see the file header). |
| `SecurityGuard` | `src/core/security-guard.ts` | Probes a target URL for missing HTTP security headers and common web vulnerabilities. Severity levels used: error, warning, critical. |
<!-- AUTO:guards:end -->

#### Guard Results

Each guard returns a structured `AuditResult`:

```typescript
interface AuditResult {
  status: 'ok' | 'warning' | 'issues' | 'error';
  module: string;              // Guard name
  issues: AuditIssue[];        // Detected issues
  message: string;             // Human-readable summary
  timestamp: number;           // When audit ran
  duration: number;            // Execution time (ms)
}

interface AuditIssue {
  code: string;                // Issue identifier
  severity: 'critical' | 'error' | 'warning' | 'info';
  title: string;               // Short title
  message: string;             // Detailed description
  location?: {                 // Source location
    file: string;
    line?: number;
  };
  recommendation?: string;     // How to fix
  tags?: string[];             // Categorization
}
```

---

##  Testing

### Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm test -- --watch

# Run specific test file
npm test -- src/core/base-guard.spec.ts

# Generate coverage report
npm test -- --coverage
```

### Test Coverage

Target: **85%+ coverage** on all modules

- **BaseGuard**: 100% coverage (256 test cases)
- **All Guards**: Comprehensive unit and integration tests
- **CLI**: E2E testing for command execution

### Test Structure

```
tests/
├── unit/                    # Unit tests for individual modules
│   └── core/
│       ├── base-guard.spec.ts
│       ├── guard-factory.spec.ts
│       └── orchestrator.spec.ts
├── integration/             # Integration tests
└── fixtures.ts              # Shared test data
```

---

##  CI/CD Pipeline

Workflows (generated from `.github/workflows/`):

<!-- AUTO:workflows:start -->
| Workflow | File | Triggers | Jobs |
|----------|------|----------|------|
| Audit | `.github/workflows/audit.yml` | push, pull_request, workflow_dispatch | `audit` |
| CI/CD Pipeline | `.github/workflows/ci.yml` | push, pull_request | `lint-and-build`, `test-and-coverage`, `self-audit`, `quality-gate`, `package-contents`, `docs-check`, `security-scan` |
| Docs | `.github/workflows/docs.yml` | push, schedule, workflow_dispatch | `refresh` |
| Release | `.github/workflows/release.yml` | push | `release` |
<!-- AUTO:workflows:end -->

### `ci.yml` jobs

<!-- AUTO:ci-jobs:start -->
- **Lint and Build** (`lint-and-build`) (matrix: node-version 20.12.0, 22.x)
- **Test and Coverage** (`test-and-coverage`)
- **Self-Audit (muraqib audit)** (`self-audit`)
- **Quality Gate** (`quality-gate`) - needs: `lint-and-build`, `test-and-coverage`, `self-audit`, `package-contents`, `security-scan`, `docs-check`
- **Package Contents** (`package-contents`)
- **Generated Docs** (`docs-check`)
- **Security Scan** (`security-scan`)
<!-- AUTO:ci-jobs:end -->

Coverage thresholds (85%) are enforced by `vitest.config.ts`; the `docs-check` job fails a PR when generated documentation is stale, and the `Docs` workflow opens a refresh PR automatically after changes land on `main`/`develop`.

### Running Locally

```bash
# Verify CI passes locally
npm run type-check    # TypeScript strict check
npm run build         # Verify compilation
npm run lint          # ESLint validation
npm test              # Run all tests
npm run docs:check    # Generated docs are up to date
```

---

##  Project Structure

The project has two layers that share the unified `AuditIssue` model:
the **guard layer** (`src/core`, `src/rules`, `src/orchestrator`, ...) runs the
13-module audit, and the **scan layer** (`src/scan`) provides OSV, Docker,
dependency resolution and AI advisory scanning.

```
src/
├── index.ts               # Public API exports
├── core/                  # Guard layer: BaseGuard + guards
│   ├── base-guard.ts      # Abstract base class for all guards
│   ├── types.ts           # Shared types (AuditIssue, AuditResult, ...)
│   ├── *-guard.ts         # memory, security, dependency, async, config, docker, compatibility
│   ├── orchestrator.ts    # Runs guards and aggregates results
│   ├── upgrade-orchestrator.ts  # Package upgrade workflow
│   ├── helpers/           # Guard helpers
│   └── performance/       # Cache, images, HTTP probe, render-blocking, optimizer
├── rules/                 # cache, bundle budget, dead code, HTTP/1 advisor
├── orchestrator/          # Unified audit pipeline (audit.ts)
├── guard/engines/         # Schema engines: zod, valibot, arktype, custom
├── config/                # Package upgrade presets (not env presets)
├── env/                   # Environment validation engine (+ platform presets)
├── ai/                    # Secret detector and AI advisor (guard layer)
├── cli/                   # CLI entry (index.ts), audit workflow, formatters
├── renderers/ + shared/   # Output renderers, logger, progress, constants
├── utils/                 # File scanner, schedule validator, manager detector
└── scan/                  # Scan layer
    ├── cli.ts             # resolve / image / runtime commands (strict arg parsing)
    ├── cli/               # resolve workflow and renderers
    ├── bridge.ts          # Merges scan results into the unified audit
    ├── scanners/
    │   ├── dependency/    # OSV client, scanner and engine (--osv)
    │   ├── docker/        # Discovery, rules and engine (--docker)
    │   └── compatibility/ # Version / peer dependency checks
    ├── core/
    │   ├── resolution/    # Dependency graph, conflict resolution, applier
    │   ├── contracts/     # Scanner and engine contracts
    │   ├── context/       # Scan context
    │   ├── findings/      # Issue model and collector
    │   ├── parsers/       # Env file parser
    │   └── runner/        # Audit runner
    ├── ai/                # AI advisor, fallback, secret detector (--ai-advisory)
    ├── guard/             # Env validation rules and engines for the scan layer
    ├── config/ + types/   # Scan configuration and types

tests/
├── unit/                  # Guard-layer tests (core, rules, env, cli, ai, ...)
├── scan/                  # Scan-layer tests (OSV, Docker, resolution, ...)
├── validate.spec.ts
└── fixtures.ts            # Shared test data

.github/workflows/
├── ci.yml                 # Build, lint, test, coverage, self-audit, package + security checks
├── audit.yml              # Runs the audit and uploads the report
├── docs.yml               # Verifies and auto-refreshes generated documentation
└── release.yml            # Publishes to npm and creates a GitHub Release on v*.*.* tags

docs/
└── REFERENCE.md           # Generated reference (do not edit by hand)
```

---

##  API Reference

### BaseGuard Methods

```typescript
// Core execution
async run(): Promise<AuditResult>
abstract execute(): Promise<AuditResult>

// Result creation
protected ok(message: string): AuditResult
protected issues(issues: AuditIssue[], message?: string): AuditResult
protected createResult(status, issues, message): AuditResult

// Issue creation
protected createIssue(
  code: string,
  severity: 'critical' | 'error' | 'warning' | 'info',
  title: string,
  message: string,
  location?: { file: string; line?: number },
  recommendation?: string,
  tags?: string[]
): AuditIssue

// Utility methods
protected log(message: string): void
protected warn(message: string): void
protected error(message: string): void
protected parseJSON<T>(json: string, fallback: T): T
protected formatDuration(ms: number): string
protected formatBytes(bytes: number): string
```

### AuditContext

```typescript
interface AuditContext {
  projectRoot: string;     // Project root directory
  timestamp: number;       // Audit timestamp
  environment: string;     // 'development' | 'production' | etc
  nodeVersion: string;     // process.version
  npmVersion: string;      // npm version
  gitBranch?: string;      // Current git branch
  gitCommit?: string;      // Current git commit hash
}
```

---

##  Development

### Build

```bash
npm run build              # TypeScript compilation
npm run dev                # Watch mode
npm run type-check         # Strict type checking
```

### Linting

```bash
npm run lint               # Run ESLint
npm run lint -- --fix      # Auto-fix issues
```

### TypeScript Configuration

- **Strict Mode**: All strict checks enabled
- **No Implicit Any**: All types must be explicit
- **Source Maps**: Generated for debugging
- **Declaration Maps**: TypeScript definition mapping

---

##  Contributing

### Code Standards

- **TypeScript**: Strict type safety required
- **Tests**: Minimum 85% coverage required
- **Linting**: Must pass ESLint before commit
- **Commits**: Atomic, descriptive commit messages

### Adding a New Guard

1. Create `src/core/new-guard.ts` extending `BaseGuard`
2. Implement `async execute(): Promise<AuditResult>`
3. Export from `src/index.ts`
4. Add tests in `tests/unit/core/new-guard.spec.ts`
5. Update README with guard details

### Commit Message Format

```
<type>(<scope>): <subject>

<body>

Co-Authored-By: <name> <email>
Claude-Session: <link>
```

Types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`

---

##  Performance Targets

| Metric | Target |
|--------|--------|
| Test Coverage | ≥85% |
| Build Time | <30s |
| Lint Time | <10s |
| Full Audit Time | <5s |
| Memory Usage | <100MB |

---

##  Related Documentation

> Facts such as versions, guards, CLI flags, scripts and workflows are **generated** from the source (`npm run docs:generate`). Blocks marked `<!-- AUTO:... -->` and `docs/REFERENCE.md` must not be edited by hand.

- [ARCHITECTURE.md](ARCHITECTURE.md) - Detailed architecture guide
- [API.md](API.md) - Complete API reference
- [docs/REFERENCE.md](docs/REFERENCE.md) - Generated reference (guards, public API, CLI, scripts, workflows)
- [CONTRIBUTING.md](CONTRIBUTING.md) - Contribution guidelines
- [CHANGELOG.md](CHANGELOG.md) - Version history

---

##  License

ISC © [Aya Almadhon](https://github.com/Ayaalmadhon2004) & [Jenan](https://github.com/Jenan04)

---

##  Acknowledgments

Built as an **AI-complementary DevTool** to enhance AI-generated code quality, security, and performance.

**Key Features:**
- ✅ Catches issues AI models may miss
- ✅ Provides structured, actionable recommendations
- ✅ Integrates with CI/CD pipelines
- ✅ TypeScript-first for type safety
- ✅ Extensible through custom guards
