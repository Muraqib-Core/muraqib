# Changelog

All notable changes to Muraqib Core will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
- 🐛 Issues: [GitHub Issues](https://github.com/Ayaalmadhon2004/-Muraqib-Core/issues)
- 💬 Discussions: [GitHub Discussions](https://github.com/Ayaalmadhon2004/-Muraqib-Core/discussions)

---

**For detailed information about each feature, please refer to the [API Reference](API.md) and [README](README.md).**
