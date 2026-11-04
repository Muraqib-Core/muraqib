---
title: Development
type: operation
created: 2026-11-04
updated: 2026-11-04
sources:
  - code: package.json
verified_at: f39b88d
---

# Development

> Part of the [Muraqib documentation](../README.md). See also [CONTRIBUTING.md](../CONTRIBUTING.md) and [ARCHITECTURE.md](../ARCHITECTURE.md).

## 🛠️ Local development
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

## ⚙️ Repository scripts <sub>(from a clone)</sub>
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

## 🧪 Testing

### Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm test -- --watch

# Run specific test file
npm test -- tests/unit/core/base-guard.spec.ts

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

## 🗂️ Project Structure

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
├── unit/                  # All unit tests, mirroring src/ (core, rules, env, cli, ai, scan, ...)
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

## 🧱 Build, lint and TypeScript

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

## 🤝 Contributing
### Code Standards

- **TypeScript**: Strict type safety required
- **Tests**: Minimum 85% coverage required
- **Linting**: Must pass ESLint before commit
- **Commits**: Atomic, descriptive commit messages

### Adding a New Guard

See [Adding a New Guard](guards.md#adding-a-new-guard).

### Commit Message Format

```
<type>(<scope>): <subject>

<body>
```

Example: `fix(secret-guard): ignore placeholder tokens in .env.example`

Types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`

## 🎯 Performance Targets
| Metric | Target |
|--------|--------|
| Test Coverage | ≥85% |
| Build Time | <30s |
| Lint Time | <10s |
| Full Audit Time | <5s |
| Memory Usage | <100MB |
