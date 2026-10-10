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

```
src/
├── index.ts                    # Main entry point & public API
├── core/
│   ├── types.ts               # Shared TypeScript interfaces
│   ├── base-guard.ts          # Abstract base class for all guards
│   ├── memory-guard.ts        # Memory/heap auditing
│   ├── security-guard.ts      # Security scanning
│   ├── dependency-guard.ts    # Circular deps, deprecated APIs
│   ├── async-guard.ts         # Floating promises, missing await
│   ├── config-guard.ts        # Configuration validation
│   ├── docker-guard.ts        # Docker best practices
│   ├── compatibility-guard.ts # Version/peer dependency checks
│   └── performance/
│       ├── auditor.ts         # Cache performance analysis
│       ├── image-guard.ts     # Image optimization auditing
│       ├── network-latency-advisor.ts
│       ├── optimizer-engine.ts # HTTP/2, compression, resources
│       ├── render-blocking.ts # Render-blocking detection
│       ├── http-probe.ts      # Network protocol measurement
│       └── html-scanner.ts    # HTML parsing utilities
├── rules/
│   ├── cache-guard.ts         # Cache strategy validation
│   ├── bundle-budget.ts       # Bundle size enforcement
│   ├── dead-code-guard.ts     # Dead code detection
│   └── http1-advisor.ts       # HTTP/1.x protocol hints
├── ai/
│   ├── secret-detector.ts     # Sensitive data detection
│   └── advisor.ts             # AI-powered recommendations
├── cli/
│   ├── index.ts               # CLI interface & audit runner
│   ├── formatters.ts          # Output formatting (JSON, console, markdown)
│   └── types.ts               # CLI type definitions
├── env.ts                     # Environment validation engine
└── utils/                     # Utility functions
    ├── file-scanner.ts        # File system scanning
    ├── schedule-validator.ts  # Cron schedule validation
    └── manager-detector.ts    # Package manager detection

tests/
├── unit/
│   ├── core/                  # Core module tests
│   └── rules/                 # Rule module tests
└── fixtures.ts                # Shared test data

.github/
└── workflows/
    └── ci.yml                 # GitHub Actions CI/CD pipeline
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
