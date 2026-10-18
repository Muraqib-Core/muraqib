# Changelog

All notable changes to Muraqib Core will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.1.0] - 2026-10-18

### Added

- Guards for the audits that only existed as workflow functions: `BundleBudgetGuard`, `RenderBlockingGuard`, `HttpOptimizerGuard`, `CachePerformanceGuard` and `EnvGuard` (all `BaseGuard`s, exported, with `GuardFactory` methods and opt-in `createAllGuards` settings). `BaseGuard.skipped()` reports a check that had nothing to measure (status `ok` plus an info issue coded `CHECK_SKIPPED`). `runBundleAudit`, `runEnvAudit`, `runPerformanceAudit`, `runOptimizerAudit` and `runRenderBlockingAudit` now run through these guards; their results are unchanged.
- Git hooks: `muraqib hook install` adds a pre-commit hook that scans only the staged changes (`git diff --cached`, added lines only) for secrets and blocks the commit on real credentials, in well under a second; `--pre-push` opts in to the heavier security audit before pushing; `muraqib hook uninstall` removes exactly Muraqib's marked blocks. Existing hooks, `core.hooksPath` and Husky are respected, and a missing binary or internal error never blocks git. `MURAQIB_SKIP_HOOKS=1` and `--no-verify` bypass, and `muraqib-ignore-secret` on a line suppresses a false positive.
- `SecretGuard` (a `BaseGuard`) for scanning added lines, and `findSecrets()` which says whether each match is strong enough to block.
- Security scorecard & compliance report: a pure, deterministic 0-100 score (`calculateScorecard`) broken down by severity (critical/high/medium/low) and domain (security/dependencies/code quality), where any critical finding hard-caps the score at 59. Rendered as Markdown (README badge, CI step summary) via `muraqib audit --report` / `--format md`; golden-file tested.
- Dynamic documentation: `npm run docs:generate` (`scripts/generate-docs.mjs`) derives `docs/REFERENCE.md` and the `<!-- AUTO:... -->` blocks in README.md, API.md and CONTRIBUTING.md (versions, badges, requirements, guards, CLI flags, npm scripts, public API, CI workflows) from the source, `package.json` and `.github/workflows/`. `npm run docs:check` fails when they are stale; the new `docs-check` CI job enforces it and the `Docs` workflow opens a refresh PR automatically.
- VS Code extension in `extension/` (separate package, built against the repository's `muraqib-core`): `Muraqib: Run Audit`, `Show Documentation` and `Show Last Report` commands; an audit report webview grouped by severity and module with scanner coverage, a strict nonce CSP, validated `postMessage` messages and an "open file at line" action restricted to the workspace; Problems-panel diagnostics; a status bar issue counter; and `muraqib.*` settings. Arabic/RTL friendly.

### Changed

- Removed the unused `rules/http1-advisor`, `utils/font-validator` and `shared/progress` modules. Package-manager detection is shared (`utils/manager-detector` now also knows `bun` and the `packageManager` field) and the four public engines share one `ValidationIssue` type.
- The two secret detectors (`src/ai/secret-detector.ts`, `src/core/helpers/secret-detector.ts`) are merged into one module, `src/core/secret-detector.ts`, with a single table of token formats shared by text scanning and env/package value checks. The public `detectSecretsInText`, `detectSecretsInEnv` and `assessSecretRisk` behave as before. Tokens are now also recognised for GitHub fine-grained and `gho_`/`ghu_`/`ghs_`/`ghr_` tokens, Slack, OpenAI-style `sk-` keys, Google API keys and JWTs in free text, and secrets are masked completely when 8 characters or shorter.
- CI/CD hardening: least-privilege `permissions`, `type-check:tests` in CI, no full-history checkouts, audit workflow limited to `main`/`develop`/PRs with concurrency control, and the release workflow now verifies that the tag matches `package.json`, type-checks and checks generated docs before publishing.
- Documentation corrected to match the code: package name (`@muraqib/core`), Node/TypeScript/Vitest versions, CI job list, guard descriptions.
- **Behaviour change:** `loadEnv` (and `createEnv`'s `envFilePath`) no longer lets a `.env` file replace a variable that is already set in the real environment. Pass `override: true` to `loadEnv`, or `overrideProcessEnv: true` to `createEnv` / `createEnvWithPresets`, to restore the previous behaviour. The returned record holds the values actually in effect. In verbose mode an undefined `$VAR` reference now logs a warning that points to single quotes / `\$`.

### Fixed

- Scan layer false positives: `PORT` accepts 1-65535 (80 and 443 are valid), `DATABASE_URL` accepts every common database scheme (`mysql://`, `mongodb://`, `file:` ...) instead of PostgreSQL only, `AWS_REGION` accepts `us-gov-*` style regions, and `MONGODB_URL` is validated like `MONGODB_URI`. Generic `*_URL` variables may use `mysql://`/`mariadb://`.
- Scan-layer `.env` parser (`parseEnvFile`) accepts the `export` prefix and multi-line quoted values (for example PEM keys), and reports findings under the project-relative file name rather than the absolute path.
- Compatibility engine compares versions with `semver` (`next@14.10` is no longer treated as `14.1`) and evaluates the whole `engines.node` range.
- `OSV_API_URL` is parsed when a query runs, so a malformed value is reported by the scan instead of crashing the CLI on import; the 5 MiB OSV response limit is enforced while the response streams in.
- A `.env` file that cannot be read, or a detected validation engine (`zod`, `valibot`, `arktype`) that is not installed, no longer aborts the whole scan: the gap is reported as a finding and coverage entry and the OSV/Docker scanners still run.
- Dead-code guard: a trailing `muraqib-ignore-dead` / `muraqib-unreachable` comment now silences only its own line (a comment-only marker line still silences the file), and the marker inside a string literal is ignored, so the guard no longer skips its own source.
- File scanner ignores `node_modules`, `dist` and `coverage` at any depth (monorepo workspaces) and skips unreadable files instead of aborting.
- Render-blocking detection reads tag attributes (not substrings): `defer`/`async` in any position, module scripts and non-JavaScript script types are not blocking, `<head lang="en">` and minified single-line documents are handled. `runRenderBlockingAudit` now reuses `performRenderBlockingAudit`.
- Report boxes and the header banner are aligned when they contain color codes, the renderers share one silent flag with the logger, and `NO_COLOR` disables ANSI colors.
- `collectAuditResults` passes the module filter to the orchestrator (`moduleFilter`) so unselected guards no longer run.
- Package-manager commands run by the resolution applier/verifier use a 64 MiB output buffer so a verbose install is not reported as a failure.
- `createEnv` typing: with no `clientPrefix` every key matched the default `""` prefix, so any `server` schema failed to compile. The prefix checks now apply only when a concrete prefix is given (and the "logical error" message no longer says "financial").
- Server/client separation is now enforced at runtime: with `isServer: false` only the `client` schema is validated and reading a server-only key from the returned env throws instead of returning `undefined`.
- `.env` parser: quoted values may span several lines (`"..."`, `'...'`, backticks); only double quotes decode `\n`/`\"`/`\\`; single-quoted and backtick values are literal (no `$VAR` expansion); `\$` writes a literal dollar; `#` starts a comment only after whitespace (so `pa#ss` survives); a BOM and invalid keys are ignored; an unterminated quote no longer swallows the rest of the file. `${VAR:-default}` now also falls back for empty values and `${VAR-default}` only for unset ones; references resolve through chains and later keys, and a self-reference such as `PATH=$PATH:/x` uses the real value instead of looping.
- A `PRIVATE KEY` header without an algorithm (`-----BEGIN PRIVATE KEY-----`, PKCS#8) or with another (`OPENSSH`, `ENCRYPTED`) was not detected in text; `urlCarriesSecret` no longer throws on a URL password with malformed percent-encoding.
- Preserve scan policy outcomes in the unified CLI: medium findings block `prod`, and scanner failures return exit code 3 rather than a generic findings exit code.
- Retain scanner coverage, scanned/skipped inputs and diagnostics in unified and agent reports; display them in text, HTML, CSV and interactive output.
- Report thrown scan execution errors as unreliable audits, including in the agent API.
- Complete missing platform-specific dependency entries in `package-lock.json` so clean `npm ci` installs work, without changing existing package versions.

### Tests

- Add integration regressions for build/prod policies, high findings, partial coverage, failed/crashed scanners and agent failure propagation.


## [1.0.3] - 2026-10-13

### ⚠️ Changed (breaking for `audit --json` consumers)

- One severity vocabulary everywhere: `critical` / `error` / `warning` / `info`. The classic report summary (`audit --json`, text, HTML and CSV) now uses these names instead of `critical` / `high` / `medium` / `low`, matching its own issue entries and the `AgentReport`. Rename `summary.high` → `summary.error`, `summary.medium` → `summary.warning`, `summary.low` → `summary.info`

### 🐛 Fixed

- `--upgrade` now runs package-manager detection, migrations and the build check inside the target project (`--path`) instead of the process working directory, and only reports packages that actually changed
- Remote presets (`remotePresetUrl`) now require an HTTPS URL, time out after 10 s and are validated against a strict schema (valid npm package names, bounded sizes); invalid payloads fall back to the local presets
- Upgrade orchestrator output goes through the shared logger, so silent mode is honoured
- Web view CSP now also sets `base-uri 'none'` and `form-action 'none'`
- `async-guard` no longer reports code that lives inside string/template literals or comments (e.g. the browser script embedded by the web view)
- `ValibotEngine` now reports the real field path of each failure instead of always `root`

### ✨ Added

- Documentation Web View: a self-contained, tabbed HTML page (`dist/webview/index.html`) and a `getWebviewHtml(nonce)` helper for VS Code webviews, with no new dependencies
- Guided interactive mode (`muraqib audit -i`): pick audit categories (Full, Security, Performance & images, Configuration, Code health), optional security URL prompt, colour-coded report with per-module results, prioritised next steps, and follow-ups (recommended fixes grouped by severity, show every issue, a paste-ready prompt to hand the findings to an AI assistant, save an HTML report), repeated until you finish. `-i` without a terminal prints a one-line note and runs normally. Direct flags and CI behaviour are unchanged
- `muraqib-core/webview/index.html` subpath export so tools and VS Code wrappers can resolve the generated page

## [1.0.1] - 2026-10-11

### 🐛 Fixed

#### Packaging & Publishing
- Ship `dist` and `bin` in the npm tarball via an explicit `files` whitelist (previously fell back to `.gitignore`), excluding compiled `*.spec.*` files
- Add `repository`, `bugs` and `homepage` metadata to `package.json`
- Add a `prepublishOnly` guard that runs build and tests before every publish

### 🧹 Changed

- Enable `exactOptionalPropertyTypes` in `tsconfig.json` and add `tsconfig.test.json` for type-checking specs
- Remove the stale `AUDIT.md` and one-off helper scripts under `scripts/`
- Unify the duplicated audit CLI: `src/scan/cli.ts` now only serves `resolve`, `image` and `runtime`; `muraqib audit` (with the new `-e/--env` and `--engine` flags) is handled solely by the primary CLI. `npm run scan` now runs `muraqib audit --osv`

### ✅ Tests

- Add unit tests for `cache-guard`, `manager-detector` and `resolve-workflow`

## [1.0.0] - 2026-10-07

### ✨ Added

#### SECTION 1: Foundation & Setup
- TypeScript 6.0+ strict configuration
- Comprehensive ESLint configuration
- Vitest with 85% coverage requirements
- GitHub Actions CI/CD pipeline

#### SECTION 2: Core Audit Modules (13+)
- **Memory Guard**: Heap/memory leak detection
- **Security Guard**: XSS, SQL injection, vulnerability detection
- **Dependency Guard**: Circular dependency detection
- **Async Guard**: Floating promises, missing awaits
- **Bundle Budget**: 14KB bundle size enforcement
- **Cache Guard**: Cache strategy validation
- **Dead Code Guard**: Unused code detection
- **Image Guard**: Image size optimization
- **Network Latency Advisor**: Network performance analysis
- **Optimizer Engine**: HTTP/2 and cookie optimization
- **HTTP Probe**: Protocol detection and measurement

#### SECTION 3: AI Integration & Enhanced Scanners
- **Docker Guard**: Dockerfile security validation
  - Base image version pinning detection
  - Root user execution detection
  - Hardcoded secret detection
  - Health check validation
  
- **Compatibility Guard**: Package compatibility auditing
  - Node.js EOL version detection
  - Deprecated package detection
  - Peer dependency conflict resolution
  
- **Secret Detector**: Sensitive information detection
  - API key detection
  - JWT token detection
  - Database URL detection
  - Private key detection
  
- **AI Advisor**: AI-powered recommendations
  - Confidence scoring
  - Context-aware suggestions
  - Code examples

#### SECTION 4: Enhanced Scanners
- **Render-Blocking Detector**: Identify render-blocking resources
  - CSS in head detection
  - Synchronous script detection
  - Font file optimization
  
- **HTML Scanner**: Comprehensive HTML validation
  - DOCTYPE detection
  - Character encoding validation
  - Alt text verification
  - Deprecated tag detection
  
- **Config Guard**: Project configuration validation
  - tsconfig.json validation
  - package.json field checking
  - ESLint configuration validation

#### SECTION 5: CLI & Output Rendering
- **CLI Interface**: Command-line argument parser
  - Flexible option handling
  - Modular selection (--modules)
  - Verbose logging
  
- **Output Formatters**:
  - **Text**: Human-readable terminal output with ASCII art
  - **JSON**: Machine-readable format for CI/CD
  - **HTML**: Interactive styled reports with charts
  - **CSV**: Spreadsheet-compatible export
  
- **CLI Features**:
  - Help system (--help)
  - Version info (--version)
  - File output (--output)
  - Fail on warning (--fail-on-warning)

#### SECTION 6: Testing & Quality
- Comprehensive test suite (47 tests)
- Docker Guard tests (7 tests)
- Compatibility Guard tests (6 tests)
- Config Guard tests (7 tests)
- Dead Code Guard tests (10 tests)
- Bundle Budget tests (10 tests)
- Image Optimizer tests (10 tests)
- Network Latency tests (10 tests)

#### SECTION 7: Documentation & Release
- Comprehensive API documentation (API.md)
- Contributing guidelines (CONTRIBUTING.md)
- Changelog (this file)
- Updated README with all features
- Type definitions for all modules

### 🏗️ Architecture

- **BaseGuard**: Abstract base class for audit modules
- **StandardSchemaV1**: Universal schema compatibility
- **Unified Type System**: Consistent AuditResult interface
- **Modular Design**: Independent, composable audit modules
- **Error Handling**: Structured error reporting

### 🖥️ CLI

- `muraqib audit` with `--osv`, `--docker` and `--ai-advisory` (scan layer merged into the same report)
- `muraqib resolve` (evidence-based dependency resolution with approval and rollback)
- `muraqib image --image <name>` (Trivy) and `muraqib runtime --container <name>` (read-only inspection)
- Exit codes: `0` clean, `1` blocking findings, `3` scanner failure

### 🧩 Unified Result Model

- A single `AuditIssue` model across guards and the scan layer (`ScanIssue` extends it)
- `UnifiedAuditResult.issues` is the sorted `AuditIssue[]` produced by the orchestrator
- The legacy `Finding` model (`Finding`, `createFinding`, `FindingCollector`, `BaseGuard.toFindings`, `UnifiedAuditResult.findings`) was removed before this first release

### 📊 Statistics

- **Total TypeScript Files**: 49
- **Total Test Cases**: 777 (Vitest)
- **Test Coverage**: 90.7% statements · 85.6% branches · 90.8% functions · 93.3% lines
- **Audit Modules**: 15+ dedicated auditors
- **Output Formats**: 4 (text, json, html, csv)
- **CLI Options**: 10+ command-line arguments

### 🔐 Security Features

- Secret detection (API keys, tokens, private keys)
- Security header validation
- XSS prevention detection
- SQL injection prevention
- Docker security checks
- Hardcoded secret detection

### 🚀 Performance Features

- Memory leak detection
- Bundle size monitoring
- Network latency analysis
- Dead code detection
- Image optimization
- HTTP/2 support detection
- Render-blocking resource detection

### 📦 Dependencies

**Core Dependencies:**
- zod@3.x (schema validation)
- valibot@0.x (schema validation)
- arktype@2.x (schema validation)
- axios@1.x (HTTP requests)
- chalk@5.x (CLI colors)
- glob@10.x (file globbing)
- semver@7.x (version parsing)
- cron-parser@4.x (schedule validation)

**Development Dependencies:**
- typescript@6.0+ (type checking)
- vitest@2.x (testing framework)
- @typescript-eslint/parser (ESLint support)
- @typescript-eslint/eslint-plugin (TypeScript rules)

### 🔄 Module Organization

```
src/
├── core/
│   ├── types.ts                    # Unified type definitions
│   ├── base-guard.ts               # Abstract base class
│   ├── memory-guard.ts             # Memory leak detection
│   ├── security-guard.ts           # Security analysis
│   ├── dependency-guard.ts         # Dependency analysis
│   ├── async-guard.ts              # Async pattern detection
│   ├── docker-guard.ts             # Docker validation
│   ├── compatibility-guard.ts      # Package compatibility
│   ├── config-guard.ts             # Config validation
│   ├── performance/
│   │   ├── auditor.ts              # Cache auditing
│   │   ├── image-guard.ts          # Image optimization
│   │   ├── network-latency-advisor.ts
│   │   ├── optimizer-engine.ts     # HTTP optimization
│   │   ├── render-blocking.ts      # Render blocking
│   │   └── html-scanner.ts         # HTML validation
│   └── performance-specific modules
├── rules/
│   ├── bundle-budget.ts            # Bundle size limits
│   ├── cache-guard.ts              # Cache strategies
│   └── dead-code-guard.ts          # Dead code detection
├── ai/
│   ├── secret-detector.ts          # Secret detection
│   └── advisor.ts                  # AI recommendations
├── cli/
│   ├── types.ts                    # CLI types
│   ├── formatters.ts               # Output formatting
│   └── index.ts                    # CLI entry point
└── index.ts                        # Main export
```

### ✅ Validation

- **TypeScript**: Strict mode with no implicit any
- **Type Safety**: 100% type-safe implementations
- **Build**: Clean compilation (0 errors)
- **Tests**: All 47 tests passing
- **Linting**: ESLint pass
- **Formatting**: Consistent code style

### 🎯 What's Next

Potential future enhancements:
- Machine learning for anomaly detection
- Integration with popular CI/CD platforms
- Web-based dashboard
- Real-time monitoring capabilities
- Custom rule builder
- Plugin system for third-party auditors

---

## Versioning

This project follows [Semantic Versioning](https://semver.org/):
- MAJOR version for incompatible API changes
- MINOR version for new features (backward compatible)
- PATCH version for bug fixes

## Contributors

- **Aya Almadhon** - Core audit modules and architecture
- **Jenan** - AI integration and advanced features

## License

ISC © 2026 Aya Almadhon & Jenan

---

## How to Upgrade

### From Previous Versions

This is the initial 1.0.0 release. No upgrade path from previous versions.

### Breaking Changes

No breaking changes in 1.0.0 (initial release).

---

## Support

- 📖 Documentation: [API.md](API.md)
- 🤝 Contributing: [CONTRIBUTING.md](CONTRIBUTING.md)
- 🐛 Issues: [GitHub Issues](https://github.com/Muraqib-Core/muraqib/issues)
- 💬 Discussions: [GitHub Discussions](https://github.com/Muraqib-Core/muraqib/discussions)

---

**For detailed information about each feature, please refer to the [API Reference](API.md) and [README](README.md).**
