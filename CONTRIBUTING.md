# Contributing to Muraqib Core

Thank you for your interest in contributing to Muraqib Core! This document provides guidelines and instructions for contributing.

## Code of Conduct

- Be respectful and inclusive
- Focus on the code, not the person
- Help others learn and grow
- Report abusive behavior to maintainers

## Getting Started

### Prerequisites
- Node.js 18+
- TypeScript 5.0+
- npm or yarn

### Setup Development Environment

```bash
# Clone the repository
git clone https://github.com/Ayaalmadhon2004/-Muraqib-Core.git
cd -muraqib-core

# Install dependencies
npm install

# Build the project
npm run build

# Run tests
npm test

# Start development mode
npm run dev
```

## Development Workflow

### 1. Create a Feature Branch

```bash
git checkout -b feature/your-feature-name
# or
git checkout -b fix/your-bug-fix
```

Use descriptive names:
- `feature/memory-leak-detection`
- `fix/docker-image-validation`
- `docs/api-reference`

### 2. Make Your Changes

**Code Style:**
- Follow TypeScript strict mode
- Use meaningful variable names
- Keep functions small and focused
- Add comments only for "why", not "what"

**File Organization:**
```
src/
├── core/          # Core audit modules
├── cli/           # CLI interface
├── performance/   # Performance auditors
├── rules/         # Specific rule validators
├── ai/            # AI integration
└── utils/         # Shared utilities
```

### 3. Write Tests

All new features must include tests:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";

describe("Feature Name", () => {
  let setup: any;

  beforeEach(() => {
    // Setup before each test
  });

  afterEach(() => {
    // Cleanup after each test
  });

  it("should do something specific", () => {
    // Arrange
    const input = "test";
    
    // Act
    const result = performAction(input);
    
    // Assert
    expect(result).toBe("expected");
  });
});
```

**Test Coverage:**
- Target: 85%+ coverage
- All public APIs must have tests
- Include both happy path and error cases

### 4. Run Quality Checks

```bash
# Type checking
npm run type-check

# Build
npm run build

# Tests
npm test

# Linting
npm run lint

# Full check
npm run build && npm test
```

### 5. Commit Your Changes

**Commit Message Format:**
```
type(scope): subject

body (optional)

footer (optional)
```

**Types:**
- `feat:` New feature
- `fix:` Bug fix
- `docs:` Documentation
- `test:` Test additions/changes
- `refactor:` Code refactoring
- `perf:` Performance improvements
- `chore:` Build, dependencies, etc.

**Examples:**
```
feat(docker-guard): add health check validation

fix(security-guard): improve SQL injection detection

docs(api): add CLI examples

test(compatibility): add EOL version tests
```

### 6. Push and Create Pull Request

```bash
git push origin feature/your-feature-name
```

**PR Title:** Clear and descriptive
**PR Description:** Include:
- What problem does this solve?
- How does it work?
- Any breaking changes?
- Testing instructions

**Example PR Description:**
```markdown
## Summary
Adds Docker configuration validation to detect security risks.

## Changes
- `src/core/docker-guard.ts` - New Docker analyzer module
- Detects unpinned base images, root user execution, hardcoded secrets
- Integrates with main audit pipeline

## Testing
Run: `npm test -- docker-guard.spec.ts`

## Checklist
- [x] Tests added/updated
- [x] Documentation updated
- [x] Build passes
- [x] Tests pass
```

## Adding a New Audit Module

### 1. Create the Module

```typescript
// src/core/new-feature-guard.ts
export interface NewFeatureResult {
  isClean: boolean;
  reports: string[];
  issues: NewFeatureIssue[];
}

export function performNewFeatureAudit(path: string): NewFeatureResult {
  const reports: string[] = [];
  const issues: NewFeatureIssue[] = [];

  // Implementation here

  return { isClean: issues.length === 0, reports, issues };
}
```

### 2. Add Tests

```typescript
// src/core/new-feature-guard.spec.ts
describe("New Feature Guard", () => {
  it("should detect issues", () => {
    const result = performNewFeatureAudit("./test");
    expect(result.isClean).toBe(false);
  });
});
```

### 3. Export from Main

```typescript
// src/index.ts
export * from "./core/new-feature-guard.js";
```

### 4. Update Documentation

- Add to API.md
- Update README.md
- Add JSDoc comments

### 5. Create PR

Submit PR with:
- Implementation
- Tests (85%+ coverage)
- Documentation
- Working examples

## Pull Request Process

1. **Review:** Maintainers review your PR
2. **Feedback:** Address any requested changes
3. **Approval:** PR is approved by at least one maintainer
4. **Tests:** All CI checks must pass
5. **Merge:** Squash and merge to main

## Testing Guidelines

### Unit Tests
```typescript
it("should handle valid input", () => {
  const result = perform Audit("valid");
  expect(result.isClean).toBe(true);
});

it("should detect issues", () => {
  const result = performAudit("invalid");
  expect(result.issues.length).toBeGreaterThan(0);
});
```

### Edge Cases
- Empty input
- Large input
- Malformed data
- Missing dependencies

### Error Scenarios
- File not found
- Permission denied
- Invalid JSON
- Network timeout

## Documentation Standards

### Code Comments
```typescript
// Only document WHY, not WHAT
// ✓ Good: Use WeakMap to prevent memory leaks in cache
const cache = new WeakMap();

// ✗ Avoid: Create a new WeakMap
```

### JSDoc
```typescript
/**
 * Performs security audit on the given path
 * @param targetPath - Root directory to audit
 * @returns Audit result with security issues
 * @throws Error if path doesn't exist
 */
export function performSecurityAudit(targetPath: string): SecurityAuditResult
```

### README Updates
- Keep feature list current
- Add examples for new features
- Update installation if dependencies changed

## Performance Considerations

- Keep audit functions under 1 second for typical projects
- Cache results when possible
- Use streaming for large files
- Profile with `npm run dev`

## Security

- Never log sensitive data (passwords, tokens, keys)
- Validate all user input
- Sanitize error messages
- Run security checks regularly

## Questions?

- 📖 Check [API.md](API.md) for API details
- 💬 Open a [GitHub Discussion](https://github.com/Ayaalmadhon2004/-Muraqib-Core/discussions)
- 🐛 Report issues in [GitHub Issues](https://github.com/Ayaalmadhon2004/-Muraqib-Core/issues)

## License

By contributing, you agree that your contributions will be licensed under the ISC License.

---

**Thank you for contributing to Muraqib Core!** 🎉
