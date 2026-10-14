# Changelog

All notable changes to Muraqib Core will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- VS Code extension in `extension/` (separate package, built against the repository's `muraqib-core`): `Muraqib: Run Audit`, `Show Documentation` and `Show Last Report` commands; an audit report webview grouped by severity and module with scanner coverage, a strict nonce CSP, validated `postMessage` messages and an "open file at line" action restricted to the workspace; Problems-panel diagnostics; a status bar issue counter; and `muraqib.*` settings. Arabic/RTL friendly.

### Fixed

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
