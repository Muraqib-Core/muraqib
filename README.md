<div align="center">

# 🔍 Muraqib Core

**Unified Developer Environment Guardian & Performance Auditor**

Comprehensive audit framework for Node.js/TypeScript projects. Detects security vulnerabilities, performance issues, architecture violations, and configuration problems in code.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.7+-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Vitest](https://img.shields.io/badge/Vitest-2.0+-729B1B?logo=vitest&logoColor=white)](https://vitest.dev)
[![CI/CD](https://img.shields.io/badge/CI%2FCD-GitHub%20Actions-2088FF?logo=github&logoColor=white)](https://github.com/Ayaalmadhon2004/-Muraqib-Core/actions)
[![License](https://img.shields.io/badge/License-ISC-yellow.svg)](LICENSE)

</div>

---

## ✨ Features

### 🔐 Security Auditing
- **Injection Prevention**: SQL/XSS detection and prevention
- **Secret Detection**: API keys, passwords, tokens, credentials
- **Auth/Crypto Validation**: Security protocols and cryptographic best practices
- **Security Headers Analysis**: HTTP security header validation

### 🚀 Performance (13+ Modules)
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

### 🏗️ Architecture Validation
- **Configuration Validation**: Environment variables and config file validation
- **Docker Best Practices**: Containerization checks and recommendations
- **Compatibility Checking**: Node.js version and peer dependency validation
- **AI-Powered Recommendations**: Context-aware issue resolution suggestions

### 🤖 AI Integration
- **AI-Complementary**: Works with AI-generated code to catch issues
- **Secret Detection**: Advanced pattern matching for sensitive data
- **Intelligent Recommendations**: AI-powered fix suggestions

---

## 📦 Installation

```bash
# Clone the repository
git clone https://github.com/Ayaalmadhon2004/-Muraqib-Core.git
cd -muraqib-core

# Install dependencies
npm install

# Build TypeScript
npm run build

# Run tests
npm test
```

---

## 🚀 Quick Start

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

## 🖥️ CLI Usage

After `npm run build`, the `muraqib` binary (`bin/muraqib.js`) exposes four commands.

| Command | Purpose |
|---------|---------|
| `muraqib audit` (default) | Run the guard modules, optionally adding the scan layer (OSV, Docker, AI advisory) |
| `muraqib resolve` | Interactive, evidence-based dependency resolution with an approval step and rollback |
| `muraqib image --image <name>` | Scan an existing local Docker image with [Trivy](https://trivy.dev) (must be installed) |
| `muraqib runtime --container <name>` | Read-only inspection of a running Docker container |

### `audit` options

```bash
muraqib audit                              # text report of every module
muraqib audit --format json                # json | text | html | csv
muraqib audit --format html -o report.html # write the report to a file
muraqib audit -p ./my-app                  # audit another project root
muraqib audit -m memory-guard,security-guard  # only matching modules
muraqib audit --fail-on-warning            # exit 1 on warnings too
```

| Flag | Effect |
|------|--------|
| `--osv` | Add the scan layer: check dependencies against [OSV](https://osv.dev) for known vulnerabilities |
| `--docker` | Add the scan layer: Docker configuration discovery (Dockerfile / Compose) |
| `--ai-advisory` | Add the scan layer plus an optional AI advisory (needs `GEMINI_API_KEY`; secrets are redacted before anything is sent) |
| `-p, --project <path>` | Project root (default: current directory) |
| `-f, --format <fmt>` | `text`, `json`, `html` or `csv` |
| `-o, --output <path>` | Write the report to a file instead of stdout |
| `-m, --modules <list>` | Comma-separated module name filter |
| `--fail-on-warning` | Treat warnings as failures |
| `-v, --verbose` | Verbose logging |

Any of `--osv`, `--docker` or `--ai-advisory` switches on the scan layer; its findings are merged into the same report. The OSV endpoint and timeout can be overridden with `OSV_API_URL` and `OSV_TIMEOUT` (ms).

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

### Exit codes

| Code | Meaning |
|------|---------|
| `0` | No blocking findings |
| `1` | Blocking findings (critical/high; warnings too with `--fail-on-warning`) |
| `3` | A scanner failed, so the result is not reliable |

---

## 📚 Architecture Overview

### Core Components

#### BaseGuard (Abstract Base Class)
The foundation for all audit modules. Each guard specializes in one audit category:

```typescript
import { BaseGuard, AuditContext, AuditResult } from 'muraqib-core';

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

| Guard | Purpose | Key Detections |
|-------|---------|-----------------|
| **MemoryGuard** | Heap/memory analysis | Memory leaks, heap dumps |
| **SecurityGuard** | Security scanning | Vulnerabilities, security headers |
| **DependencyGuard** | Dependency analysis | Circular deps, duplicates, deprecated APIs |
| **AsyncGuard** | Async pattern validation | Floating promises, missing awaits |
| **ConfigGuard** | Configuration validation | Missing env vars, invalid settings |
| **DockerGuard** | Docker best practices | Containerization checks |
| **CompatibilityGuard** | Version compatibility | Node.js EOL, peer dependencies |
| **ImageGuard** | Image optimization | Image size, format, optimization |
| **DeadCodeGuard** | Code quality | Unreachable code, unused exports |

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

## 🧪 Testing

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

## 🔄 CI/CD Pipeline

GitHub Actions workflow with multi-stage validation:

### Jobs

1. **lint-and-build** (Matrix: Node 18.x, 20.x)
   - Type checking
   - Build compilation
   - ESLint validation
   - Artifact upload

2. **test-and-coverage**
   - Vitest execution
   - Coverage report generation
   - Codecov upload
   - Coverage artifacts

3. **quality-gate**
   - Validates lint-and-build success
   - Validates test-and-coverage success
   - Overall pipeline check

4. **security-scan** (Main branch only)
   - npm audit --production
   - Vulnerable dependency detection

### Running Locally

```bash
# Verify CI passes locally
npm run type-check    # TypeScript strict check
npm run build         # Verify compilation
npm run lint          # ESLint validation
npm test              # Run all tests
```

---

## 📋 Project Structure

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
├── presets/ + config/     # Validation presets
├── env/ + env.ts          # Environment validation engine
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
├── ci.yml                 # Build, lint, test and coverage
├── audit.yml              # Runs the audit on push
└── release.yml            # Creates a GitHub Release on v*.*.* tags
```

---

## 🔌 API Reference

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

## 🛠️ Development

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

## 📝 Contributing

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

## 📊 Performance Targets

| Metric | Target |
|--------|--------|
| Test Coverage | ≥85% |
| Build Time | <30s |
| Lint Time | <10s |
| Full Audit Time | <5s |
| Memory Usage | <100MB |

---

## 🔗 Related Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md) - Detailed architecture guide
- [API.md](API.md) - Complete API reference
- [CONTRIBUTING.md](CONTRIBUTING.md) - Contribution guidelines
- [CHANGELOG.md](CHANGELOG.md) - Version history

---

## 📄 License

ISC © [Aya Almadhon](https://github.com/Ayaalmadhon2004) & Jenan

---

## 🙏 Acknowledgments

Built as an **AI-complementary DevTool** to enhance AI-generated code quality, security, and performance.

**Key Features:**
- ✅ Catches issues AI models may miss
- ✅ Provides structured, actionable recommendations
- ✅ Integrates with CI/CD pipelines
- ✅ TypeScript-first for type safety
- ✅ Extensible through custom guards
