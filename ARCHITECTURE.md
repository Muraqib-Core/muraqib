# 🏗️ Muraqib Core Architecture

## Overview

Muraqib Core is a modular, extensible audit framework built on a unified Guard pattern. The architecture emphasizes:

- **Type Safety**: Strict TypeScript with no implicit any
- **Modularity**: Each guard specializes in one audit domain
- **Parallelization**: Concurrent guard execution for performance
- **Extensibility**: Easy to add custom guards
- **Testability**: 85%+ coverage target with comprehensive tests

---

## Core Patterns

### 1. BaseGuard Pattern

All audit modules extend the abstract `BaseGuard` class:

```typescript
export abstract class BaseGuard {
  protected module: string;
  protected context?: AuditContext;

  constructor(module: string, context?: AuditContext) {
    this.module = module;
    this.context = context;
  }

  // Subclasses implement this
  abstract execute(): Promise<AuditResult>;

  // Automatic error handling and timing
  async run(): Promise<AuditResult> {
    this.startTime = Date.now();
    try {
      return await this.execute();
    } catch (error) {
      return this.createErrorResult(error);
    }
  }

  // Utility methods for creating structured results
  protected ok(message: string): AuditResult
  protected issues(issues: AuditIssue[]): AuditResult
  protected createIssue(...): AuditIssue
}
```

**Benefits:**
- Consistent error handling across all guards
- Automatic execution timing
- Standardized result structure
- Shared utility methods (logging, formatting)

### 2. AuditContext

Metadata passed to guards for context-aware auditing:

```typescript
interface AuditContext {
  projectRoot: string;      // Project directory
  timestamp: number;        // Audit start time
  environment: string;      // dev/prod/staging
  nodeVersion: string;      // Node version
  npmVersion: string;       // npm version
  gitBranch?: string;       // Current branch
  gitCommit?: string;       // Current commit
}
```

**Usage:**
```typescript
const context: AuditContext = {
  projectRoot: process.cwd(),
  timestamp: Date.now(),
  environment: 'production',
  nodeVersion: process.version,
  npmVersion: '9.0.0',
  gitBranch: 'main',
  gitCommit: 'abc123',
};

const guard = new MemoryGuard(context);
const result = await guard.run();
```

### 3. Result Structure

Every guard returns a consistent `AuditResult`:

```typescript
interface AuditResult {
  status: 'ok' | 'warning' | 'issues' | 'error';
  module: string;              // Guard name
  issues: AuditIssue[];        // Detected issues
  message: string;             // Summary message
  timestamp: number;           // When audit ran
  duration: number;            // Execution time
}

interface AuditIssue {
  code: string;                // Issue identifier (e.g., 'MEM_001')
  severity: 'critical' | 'error' | 'warning' | 'info';
  title: string;               // Short title
  message: string;             // Detailed description
  location?: {                 // Source location
    file: string;
    line?: number;
  };
  recommendation?: string;     // How to fix
  tags?: string[];             // Categorization tags
}
```

---

## Guard Categories

### Security Guards

**SecurityGuard** - Scans for vulnerabilities and security issues

```typescript
class SecurityGuard extends BaseGuard {
  async execute(): Promise<AuditResult> {
    // Checks for:
    // - SQL injection patterns
    // - XSS vulnerabilities
    // - Insecure crypto usage
    // - Missing security headers
  }
}
```

### Performance Guards

**MemoryGuard** - Detects memory leaks and heap issues

```typescript
class MemoryGuard extends BaseGuard {
  async execute(): Promise<AuditResult> {
    // Analyzes:
    // - Heap snapshot analysis
    // - Memory growth patterns
    // - Retained objects
    // - Event listener leaks
  }
}
```

**ImageGuard** - Image optimization auditing

```typescript
class ImageGuard extends BaseGuard {
  async execute(): Promise<AuditResult> {
    // Checks for:
    // - Large unoptimized images
    // - Inefficient formats
    // - Missing responsive images
    // - Slow delivery times
  }
}
```

### Quality Guards

**DependencyGuard** - Analyzes project dependencies

```typescript
class DependencyGuard extends BaseGuard {
  async execute(): Promise<AuditResult> {
    // Detects:
    // - Circular dependencies
    // - Duplicate packages
    // - Deprecated APIs
    // - Outdated versions
  }
}
```

**AsyncGuard** - Validates async patterns

```typescript
class AsyncGuard extends BaseGuard {
  async execute(): Promise<AuditResult> {
    // Finds:
    // - Floating promises
    // - Missing await keywords
    // - Incorrect error handling
    // - Race conditions
  }
}
```

### Architecture Guards

**ConfigGuard** - Configuration validation

```typescript
class ConfigGuard extends BaseGuard {
  async execute(): Promise<AuditResult> {
    // Validates:
    // - Environment variables
    // - Config file structure
    // - Required settings
    // - Type correctness
  }
}
```

**CompatibilityGuard** - Version and peer dependency checks

```typescript
class CompatibilityGuard extends BaseGuard {
  async execute(): Promise<AuditResult> {
    // Checks for:
    // - Node.js EOL versions
    // - Peer dependency conflicts
    // - API deprecations
    // - Version mismatches
  }
}
```

**DockerGuard** - Containerization best practices

```typescript
class DockerGuard extends BaseGuard {
  async execute(): Promise<AuditResult> {
    // Validates:
    // - Dockerfile best practices
    // - Container security
    // - Layer optimization
    // - Health checks
  }
}
```

---

## Execution Flow

### Single Guard Execution

```
┌─────────────────────────┐
│   Guard Instance        │
│   .run() called         │
└────────┬────────────────┘
         │
         ▼
┌─────────────────────────┐
│  Measure start time     │
│  execute() called       │
└────────┬────────────────┘
         │
         ├─── Success ─────────────┐
         │                         │
         └─── Error ──────┐        │
                          │        ▼
                          └──► createErrorResult()
                                  │
                                  ▼
┌─────────────────────────────────────────────────┐
│  Return AuditResult                             │
│  {                                              │
│    status: 'ok' | 'warning' | 'issues' | 'error'
│    module: 'guard-name',                        │
│    issues: [...],                               │
│    message: 'Summary',                          │
│    timestamp: Date.now(),                       │
│    duration: elapsed                            │
│  }                                              │
└─────────────────────────────────────────────────┘
```

### Parallel Guard Execution (Future: Orchestrator Pattern)

While not currently implemented in the codebase, the architecture supports future parallel execution:

```
┌──────────────────────────────────────────────────────────┐
│              Guard 1: MemoryGuard                         │
│              Guard 2: SecurityGuard                       │
│              Guard 3: DependencyGuard                     │
│              Guard 4: AsyncGuard                          │
│              Guard 5: ConfigGuard                         │
│              Guard 6: CompatibilityGuard                  │
│              Guard 7: DockerGuard                         │
└──────────┬─────────────────────────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────────────────────┐
│  Promise.allSettled([guard1.run(), guard2.run(), ...])   │
└──────────┬─────────────────────────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────────────────────┐
│  Aggregate Results                                       │
│  - Combine all issues                                    │
│  - Sort by severity (critical → error → warning → info)  │
│  - Calculate summary statistics                          │
└──────────┬─────────────────────────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────────────────────┐
│  Return UnifiedAuditResult                               │
│  {                                                       │
│    success: boolean,                                     │
│    results: AuditResult[],                               │
│    findings: Finding[],                                  │
│    summary: {                                            │
│      totalIssues: number,                                │
│      critical: number,                                   │
│      errors: number,                                     │
│      warnings: number,                                   │
│      duration: number                                    │
│    }                                                     │
│  }                                                       │
└──────────────────────────────────────────────────────────┘
```

---

## Key Design Decisions

### 1. Abstract Base Class over Mixins

**Why:** 
- Single inheritance is simpler than managing multiple mixins
- Clearer contract with `execute()` method
- Easier to trace error handling flow

### 2. Promise.allSettled for Parallel Execution

**Why:**
- Continues even if individual guards fail
- Captures rejection reasons for reporting
- Better performance than sequential execution

### 3. Severity-Based Sorting

**Levels:**
```
critical (1) > error (2) > warning (3) > info (4)
```

**Why:**
- Most important issues appear first
- Developers can triage by severity
- Flexible sorting (severity, module, time)

### 4. Type-Safe Result Structure

**Why:**
- Discriminated union types for status
- Required fields prevent incomplete results
- Easy to extend without breaking consumers

---

## File Organization

```
src/
├── core/
│   ├── base-guard.ts              # Abstract base class
│   ├── types.ts                   # Shared interfaces
│   ├── *-guard.ts                 # Individual guard implementations
│   └── performance/               # Performance-specific guards
│
├── rules/                         # Quality and security rules
├── ai/                            # AI-powered modules
├── cli/                           # Command-line interface
├── env.ts                         # Environment handling
├── index.ts                       # Public API exports
└── utils/                         # Shared utilities
```

**Principles:**
- One file per guard/feature
- Shared types in `types.ts`
- Utilities kept separate for reusability
- Public API clearly defined in `index.ts`

---

## Extension Points

### Creating a Custom Guard

```typescript
// 1. Create new guard file
// src/core/my-guard.ts

import { BaseGuard, AuditResult, AuditContext } from './index.js';

export class MyGuard extends BaseGuard {
  constructor(context?: AuditContext) {
    super('my-guard', context);
  }

  async execute(): Promise<AuditResult> {
    try {
      // Implement audit logic
      const issues = await this.performAudit();
      
      if (issues.length === 0) {
        return this.ok('No issues found');
      }
      
      return this.issues(issues, `Found ${issues.length} issue(s)`);
    } catch (error) {
      this.error(`Guard failed: ${error}`);
      throw error;
    }
  }

  private async performAudit() {
    const results = [];
    
    // Your audit logic here
    results.push(
      this.createIssue(
        'MY_001',
        'warning',
        'Issue Title',
        'Issue description',
        { file: 'src/file.ts', line: 42 },
        'How to fix this',
        ['category', 'tag']
      )
    );
    
    return results;
  }
}

// 2. Export from main API
// src/index.ts
export * from './core/my-guard.js';

// 3. Add tests
// tests/unit/core/my-guard.spec.ts
describe('MyGuard', () => {
  it('should detect issues', async () => {
    const guard = new MyGuard();
    const result = await guard.run();
    expect(result).toBeDefined();
  });
});
```

### Custom Result Formatters

```typescript
// Format results for consumption
interface Finding {
  id: string;
  type: string;
  severity: string;
  title: string;
  description: string;
  file?: string;
  line?: number;
  resolution?: string;
  tags?: string[];
  createdAt: number;
}

// Use BaseGuard.toFindings() to convert
const findings = guard.toFindings(result);
```

---

## Severity Levels

| Level | Priority | Typical Issues | Response |
|-------|----------|----------------|----------|
| **critical** | Highest | Security breach, data loss | Fix immediately |
| **error** | High | Broken functionality, major bugs | Fix before release |
| **warning** | Medium | Potential issues, anti-patterns | Address soon |
| **info** | Low | Suggestions, improvements | Consider for next cycle |

---

## Testing Strategy

### Unit Tests

Each guard has unit tests covering:
- Happy path (no issues)
- Multiple issue detection
- Error handling
- Result structure validation

### Integration Tests

- Multiple guards working together
- Result aggregation
- Sorting and filtering
- CLI integration

### Coverage Targets

- BaseGuard: **100%**
- Individual Guards: **85%+**
- Overall Project: **85%+**

---

## Performance Characteristics

| Operation | Typical Time | Target |
|-----------|--------------|--------|
| Single guard execution | 50-500ms | <1s |
| Parallel 7 guards | 300-800ms | <2s |
| Full audit pipeline | 500-1000ms | <5s |
| Lint + Build + Test | <30s | <1min |

---

## Future Enhancements

1. **Orchestrator Pattern**: Centralized guard coordination with Promise.allSettled
2. **Caching**: Cache results for unchanged inputs
3. **Incremental Audits**: Only audit changed files
4. **Custom Rules Engine**: User-defined audit rules
5. **Integration Plugins**: ESLint, Prettier, PostCSS integration
6. **Web Dashboard**: Visual results display
7. **CI/CD Integration**: GitHub/GitLab/Bitbucket reporting

---

## References

- [README.md](README.md) - User guide and quick start
- [API.md](API.md) - Complete API reference
- [CONTRIBUTING.md](CONTRIBUTING.md) - Development guidelines
