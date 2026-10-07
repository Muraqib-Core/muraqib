# Muraqib Core API Reference

Complete API documentation for Muraqib Core - the comprehensive code auditor for TypeScript/Node.js projects.

## Table of Contents

- [Installation](#installation)
- [Core Auditors](#core-auditors)
- [Performance Modules](#performance-modules)
- [Rules & Validators](#rules--validators)
- [AI Integration](#ai-integration)
- [Configuration](#configuration)
- [CLI Usage](#cli-usage)

---

## Installation

```bash
npm install muraqib-core
```

### Requirements
- Node.js 18+
- TypeScript 5.0+

---

## Core Auditors

### Memory Guard

Detects memory leaks and heap usage anomalies.

```typescript
import { performMemoryAudit } from "muraqib-core";

const result = performMemoryAudit({
  heapWarnMb: 512,
  heapCriticalMb: 1024,
  rssWarnMb: 1024,
  externalWarnMb: 256,
  heapRatioWarn: 0.85,
});

// Returns: { isOptimized, reports, heapUsedMb, heapTotalMb, ... }
```

**Options:**
- `heapWarnMb` (default: 512) - Warn if heap usage exceeds this (MB)
- `heapCriticalMb` (default: 1024) - Critical if heap usage exceeds this (MB)
- `rssWarnMb` (default: 1024) - Warn if RSS memory exceeds this (MB)
- `externalWarnMb` (default: 256) - Warn if external memory exceeds this (MB)
- `heapRatioWarn` (default: 0.85) - Warn if heap ratio exceeds this

### Security Guard

Analyzes code for security vulnerabilities (XSS, SQL injection, etc.).

```typescript
import { performSecurityAudit } from "muraqib-core";

const result = performSecurityAudit(targetPath);
// Returns: { isClean, reports, xssIssues, sqlInjectionIssues, ... }
```

### Dependency Guard

Detects circular dependencies, duplicates, and deprecated APIs.

```typescript
import { performDependencyAudit } from "muraqib-core";

const result = performDependencyAudit(targetPath);
// Returns: { isClean, reports, circularDeps, deprecatedApis, ... }
```

### Async Guard

Detects floating promises, missing awaits, and callback hell patterns.

```typescript
import { performAsyncAudit } from "muraqib-core";

const result = performAsyncAudit(targetPath);
// Returns: { isClean, reports, unhandledPromises, missingAwait, ... }
```

### Docker Guard

Validates Dockerfile security and best practices.

```typescript
import { performDockerAudit } from "muraqib-core";

const result = performDockerAudit(projectRoot);
// Returns: { isSecure, reports, criticalIssues, blockingResources }
```

**Checks:**
- Base image version pinning (detects `latest`)
- Root user execution (CRITICAL)
- Hardcoded secrets in ENV/RUN
- Health check presence
- Alpine variant optimization

### Compatibility Guard

Audits Node.js and package compatibility.

```typescript
import { performCompatibilityAudit } from "muraqib-core";

const result = performCompatibilityAudit(projectRoot);
// Returns: { isCompatible, reports, issues, configFiles }
```

**Checks:**
- Node.js EOL version detection (14, 16)
- Deprecated package detection
- Peer dependency conflicts

### Config Guard

Validates project configuration files.

```typescript
import { performConfigAudit } from "muraqib-core";

const result = performConfigAudit(projectRoot);
// Returns: { isHealthy, reports, issues, configFiles }
```

**Validates:**
- package.json (required fields, engines)
- tsconfig.json (strict mode settings)
- Presence of critical configs

---

## Performance Modules

### Bundle Auditor

Enforces bundle size budget (default: 14KB).

```typescript
import { performBundleBudgetAudit } from "muraqib-core";

const result = performBundleBudgetAudit(projectRoot, { budgetKb: 14 });
// Returns: { status, issues, message, timestamp, duration }
```

### Image Guard

Detects oversized and unoptimized images.

```typescript
import { performImageAudit } from "muraqib-core";

const result = performImageAudit(projectRoot, { limit: 500 }); // KB
// Returns: { reports, violations, suggestions }
```

### Network Latency Advisor

Measures network performance and latency issues.

```typescript
import { performNetworkAudit } from "muraqib-core";

const result = await performNetworkAudit("http://localhost:3000");
// Returns: { latencyMs, dnsMs, tcpMs, tlsMs, ttfbMs }
```

### Optimizer Engine

Analyzes HTTP/2, cookies, and resource optimization.

```typescript
import { performOptimizerAudit } from "muraqib-core";

const result = performOptimizerAudit(projectRoot);
// Returns: { recommendations, http2Support, cookies, ... }
```

### Render-Blocking Detector

Identifies resources that block initial page render.

```typescript
import { performRenderBlockingAudit } from "muraqib-core";

const result = performRenderBlockingAudit(htmlContent);
// Returns: { isOptimized, reports, criticalIssues, blockingResources }
```

### HTML Scanner

Comprehensive HTML quality analysis.

```typescript
import { scanHtml } from "muraqib-core";

const result = scanHtml(htmlContent);
// Returns: { isValid, reports, issues, statistics }
```

**Validates:**
- DOCTYPE presence
- Character encoding
- Viewport meta tag
- Page title
- Language attribute
- Missing alt text on images
- Deprecated tags

---

## Rules & Validators

### Dead Code Guard

Detects unused functions, exports, and unreachable code.

```typescript
import { performDeadCodeAudit } from "muraqib-core";

const result = performDeadCodeAudit(targetPath);
// Returns: { isClean, reports, emptyFunctions, unreachableBranches, ... }
```

### Cache Guard

Validates cache strategy optimization.

```typescript
import { performCacheAudit } from "muraqib-core";

const result = performCacheAudit(projectRoot);
// Returns: { isOptimized, reports, issues }
```

---

## AI Integration

### Secret Detector

Detects sensitive information in code (API keys, tokens, etc.).

```typescript
import { detectSecrets } from "muraqib-core";

const result = await detectSecrets(codeContent);
// Returns: { found, secrets: [{ type, line, severity, details }] }
```

**Patterns Detected:**
- API Keys (20+ character alphanumeric)
- Database URLs (MongoDB, PostgreSQL, MySQL, SQLite)
- JWT Tokens
- Private Keys (RSA/PEM format)

### AI Advisor

Provides AI-powered recommendations for detected issues.

```typescript
import { getAIRecommendation } from "muraqib-core";

const recommendation = await getAIRecommendation("memory_leak", details);
// Returns: { issue, recommendation, examples, confidence }
```

---

## Configuration

### TypeScript Configuration

Muraqib requires TypeScript with strict settings:

```json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true
  }
}
```

---

## CLI Usage

### Basic Audit

```bash
muraqib
```

### With Options

```bash
# Generate HTML report
muraqib --format html --output report.html

# JSON output for CI/CD
muraqib --format json --project ./src

# Run specific modules
muraqib --modules memory-guard,security-guard

# Verbose logging
muraqib --verbose
```

### Available Options

```
-p, --project <path>       Project root directory (default: cwd)
-f, --format <format>      Output format: json|text|html|csv
-o, --output <path>        Output file path
-v, --verbose              Enable verbose logging
-m, --modules <list>       Specific modules to run
    --fail-on-warning      Exit with code 1 if warnings found
-h, --help                 Show help message
    --version              Show version
```

### Output Formats

**Text** (default)
```
╔════════════════════════════════════════════╗
║         Muraqib Audit Report              ║
╚════════════════════════════════════════════╝

📊 Summary
──────────────────────────────
  Total Issues:  15
  🔴 Critical:   2
  🟠 High:       5
  🟡 Medium:     6
  🔵 Low:        2
```

**JSON**
```json
{
  "timestamp": 1696790400000,
  "projectRoot": "/path/to/project",
  "summary": {
    "total": 15,
    "critical": 2,
    "high": 5,
    "medium": 6,
    "low": 2
  },
  "modules": {}
}
```

**HTML**
Interactive styled report with charts and module breakdown.

**CSV**
Spreadsheet-compatible format.

---

## Common Patterns

### Running All Audits

```typescript
import {
  performMemoryAudit,
  performSecurityAudit,
  performDependencyAudit,
  performAsyncAudit,
  performBundleBudgetAudit,
} from "muraqib-core";

async function runFullAudit(projectRoot: string) {
  const results = await Promise.all([
    Promise.resolve(performMemoryAudit()),
    Promise.resolve(performSecurityAudit(projectRoot)),
    Promise.resolve(performDependencyAudit(projectRoot)),
    Promise.resolve(performAsyncAudit(projectRoot)),
    Promise.resolve(performBundleBudgetAudit(projectRoot)),
  ]);

  return results;
}
```

### CI/CD Integration

```bash
#!/bin/bash
# .github/workflows/audit.yml
- name: Run Muraqib Audit
  run: muraqib --format json --fail-on-warning --output audit.json

- name: Upload Report
  uses: actions/upload-artifact@v3
  with:
    name: muraqib-audit
    path: audit.json
```

---

## Type Definitions

### AuditResult

```typescript
interface AuditResult {
  status: "ok" | "issues" | "warning" | "error";
  module: string;
  issues: AuditIssue[];
  message: string;
  timestamp: number;
  duration: number;
}
```

### AuditIssue

```typescript
interface AuditIssue {
  code: string;
  severity: "critical" | "error" | "warning" | "info";
  title: string;
  message: string;
  location?: {
    file?: string;
    line?: number;
    column?: number;
  };
  recommendation?: string;
  tags: string[];
}
```

---

## Error Handling

All audit functions return structured results with status information:

```typescript
const result = performSecurityAudit(targetPath);

if (result.status === "error") {
  console.error("Audit failed:", result.message);
  process.exit(1);
}

for (const issue of result.issues) {
  if (issue.severity === "critical") {
    console.error(`[CRITICAL] ${issue.title}: ${issue.message}`);
  }
}
```

---

## Performance Tips

1. **Use specific modules** instead of running all audits:
   ```bash
   muraqib --modules memory-guard,security-guard
   ```

2. **Cache results** in CI/CD to avoid redundant runs
3. **Set reasonable limits** for bundle size and image optimization
4. **Use `--fail-on-warning`** in CI to enforce standards

---

## Support & Contributing

- 🐛 Report bugs: [GitHub Issues](https://github.com/Ayaalmadhon2004/-Muraqib-Core/issues)
- 💡 Suggest features: [GitHub Discussions](https://github.com/Ayaalmadhon2004/-Muraqib-Core/discussions)
- 🤝 Contributing: See [CONTRIBUTING.md](CONTRIBUTING.md)

---

**Version:** 1.0.0  
**License:** ISC  
**Last Updated:** 2026
