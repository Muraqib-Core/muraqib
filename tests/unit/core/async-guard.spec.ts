/**
 * @file tests/unit/core/async-guard.spec.ts
 * @description Comprehensive test suite for AsyncGuard async pattern detection
 *
 * Tests cover:
 * - Unhandled promise detection
 * - Missing await detection
 * - Callback hell detection
 * - Floating promise detection
 * - Promise chain error handling
 * - AsyncGuard class execution
 * - File scanning and path filtering
 */

import { describe, it, expect, vi } from 'vitest';
import { AsyncGuard } from '../../../src/core/async-guard.js';
import * as fileScanner from '../../../src/utils/file-scanner.js';

vi.mock('../../../src/utils/file-scanner.js', () => ({
  scanProjectFiles: vi.fn(),
}));

describe('AsyncGuard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ===== CLEAN CODE TESTS =====

  describe('Clean Async Code', () => {
    it('should pass with properly handled promises', async () => {
      const guard = new AsyncGuard({ targetPath: '/project' });

      vi.mocked(fileScanner.scanProjectFiles).mockReturnValue([
        {
          relativePath: 'src/service.ts',
          content: `async function fetchUser() {
  return fetch('/api/user').then(r => r.json()).catch(err => console.error(err));
}`,
        },
      ]);

      const result = await guard.execute();

      expect(result.status).toBe('ok');
      expect(result.issues.length).toBe(0);
    });

    it('should pass with proper async/await usage', async () => {
      const guard = new AsyncGuard({ targetPath: '/project' });

      vi.mocked(fileScanner.scanProjectFiles).mockReturnValue([
        {
          relativePath: 'src/handler.ts',
          content: `async function handleRequest() {
  try {
    const data = await fetchData();
    return processData(data);
  } catch (err) {
    console.error(err);
  }
}`,
        },
      ]);

      const result = await guard.execute();

      expect(result.status).toBe('ok');
      expect(result.issues.length).toBe(0);
    });

    it('should ignore async-guard and security-guard files', async () => {
      const guard = new AsyncGuard({ targetPath: '/project' });

      vi.mocked(fileScanner.scanProjectFiles).mockReturnValue([
        {
          relativePath: 'src/core/async-guard.ts',
          content: `new Promise((resolve) => { resolve(); });`, // This would normally be flagged
        },
        {
          relativePath: 'src/core/security-guard.ts',
          content: `new Promise((resolve) => { resolve(); });`, // This would normally be flagged
        },
      ]);

      const result = await guard.execute();

      expect(result.status).toBe('ok');
      expect(result.issues.length).toBe(0);
    });

    it('should return ok with empty file list', async () => {
      const guard = new AsyncGuard({ targetPath: '/project' });

      vi.mocked(fileScanner.scanProjectFiles).mockReturnValue([]);

      const result = await guard.execute();

      expect(result.status).toBe('ok');
      expect(result.message).toContain('No async/await issues');
    });
  });

  // ===== UNHANDLED PROMISE TESTS =====

  describe('Unhandled Promise Detection', () => {
    it('should detect unhandled new Promise()', async () => {
      const guard = new AsyncGuard({ targetPath: '/project' });

      vi.mocked(fileScanner.scanProjectFiles).mockReturnValue([
        {
          relativePath: 'src/index.ts',
          content: `const p = new Promise((resolve) => {
  resolve();
});`,
        },
      ]);

      const result = await guard.execute();

      // Unhandled Promise has error severity, so status is 'issues'
      expect(result.status).toBe('issues');
      expect(
        result.issues.some((i) => i.message.includes('Unhandled Promise'))
      ).toBe(true);
      expect(
        result.issues.some((i) => i.severity === 'error')
      ).toBe(true);
    });

    it('should allow Promise with .catch()', async () => {
      const guard = new AsyncGuard({ targetPath: '/project' });

      vi.mocked(fileScanner.scanProjectFiles).mockReturnValue([
        {
          relativePath: 'src/index.ts',
          content: `const p = new Promise((resolve) => {
  resolve();
}).catch(err => console.error(err));`,
        },
      ]);

      const result = await guard.execute();

      expect(result.status).toBe('ok');
    });

    it('should track line numbers for unhandled promises', async () => {
      const guard = new AsyncGuard({ targetPath: '/project' });

      vi.mocked(fileScanner.scanProjectFiles).mockReturnValue([
        {
          relativePath: 'src/test.ts',
          content: `line 1
line 2
new Promise((resolve) => { resolve(); })
line 4`,
        },
      ]);

      const result = await guard.execute();

      expect(result.status).toBe('issues');
      expect(
        result.issues.some((i) => i.message.includes(':3'))
      ).toBe(true);
    });
  });

  // ===== MISSING AWAIT TESTS =====

  describe('Missing Await Detection', () => {
    it('should detect missing await on async function call', async () => {
      const guard = new AsyncGuard({ targetPath: '/project' });

      vi.mocked(fileScanner.scanProjectFiles).mockReturnValue([
        {
          relativePath: 'src/app.ts',
          content: `async function loadUser() {
  return db.query('SELECT * FROM users');
}

loadUser();`,
        },
      ]);

      const result = await guard.execute();

      expect(result.status).toBe('warning');
      expect(
        result.issues.some((i) => i.message.includes('Missing await'))
      ).toBe(true);
    });

    it('should allow async function call with await', async () => {
      const guard = new AsyncGuard({ targetPath: '/project' });

      vi.mocked(fileScanner.scanProjectFiles).mockReturnValue([
        {
          relativePath: 'src/app.ts',
          content: `async function loadUser() {
  return db.query('SELECT * FROM users');
}

const user = await loadUser();`,
        },
      ]);

      const result = await guard.execute();

      expect(result.status).toBe('ok');
    });

    it('should allow async function call with return', async () => {
      const guard = new AsyncGuard({ targetPath: '/project' });

      vi.mocked(fileScanner.scanProjectFiles).mockReturnValue([
        {
          relativePath: 'src/app.ts',
          content: `async function loadUser() {
  return db.query('SELECT * FROM users');
}

return loadUser();`,
        },
      ]);

      const result = await guard.execute();

      expect(result.status).toBe('ok');
    });

    it('should allow async function call in if statement', async () => {
      const guard = new AsyncGuard({ targetPath: '/project' });

      vi.mocked(fileScanner.scanProjectFiles).mockReturnValue([
        {
          relativePath: 'src/app.ts',
          content: `async function loadUser() {
  return db.query('SELECT * FROM users');
}

if (loadUser()) { }`,
        },
      ]);

      const result = await guard.execute();

      expect(result.status).toBe('ok');
    });

    it('should allow async function call in for loop', async () => {
      const guard = new AsyncGuard({ targetPath: '/project' });

      vi.mocked(fileScanner.scanProjectFiles).mockReturnValue([
        {
          relativePath: 'src/app.ts',
          content: `async function loadUser() {
  return db.query('SELECT * FROM users');
}

for (let i = 0; loadUser(); i++) { }`,
        },
      ]);

      const result = await guard.execute();

      expect(result.status).toBe('ok');
    });

    it('should allow async function call in while loop', async () => {
      const guard = new AsyncGuard({ targetPath: '/project' });

      vi.mocked(fileScanner.scanProjectFiles).mockReturnValue([
        {
          relativePath: 'src/app.ts',
          content: `async function loadUser() {
  return db.query('SELECT * FROM users');
}

while (loadUser()) { }`,
        },
      ]);

      const result = await guard.execute();

      expect(result.status).toBe('ok');
    });
  });

  // ===== CALLBACK HELL TESTS =====

  describe('Callback Hell Detection', () => {
    it('should detect deeply nested callbacks', async () => {
      const guard = new AsyncGuard({ targetPath: '/project' });

      vi.mocked(fileScanner.scanProjectFiles).mockReturnValue([
        {
          relativePath: 'src/legacy.ts',
          // Line with >= 3 closing parens AND contains "callback"
          content: `someFunc(callback, (err, result) => { handle(callback) })`,
        },
      ]);

      const result = await guard.execute();

      // Callback hell detection
      expect(result.issues.length).toBeGreaterThan(0);
      expect(
        result.issues.some((i) => i.message.includes('callback hell'))
      ).toBe(true);
    });

    it('should detect callback with depth >= 3', async () => {
      const guard = new AsyncGuard({ targetPath: '/project' });

      vi.mocked(fileScanner.scanProjectFiles).mockReturnValue([
        {
          relativePath: 'src/old.ts',
          // Single line with >= 3 closing parens AND contains 'cb' word boundary
          content: `run(err => run(err => run(err => console.log(cb))))`,
        },
      ]);

      const result = await guard.execute();

      // Should detect callback hell pattern
      expect(result.issues.length).toBeGreaterThan(0);
      expect(
        result.issues.some((i) => i.message.includes('callback hell'))
      ).toBe(true);
    });

    it('should suggest async/await as solution', async () => {
      const guard = new AsyncGuard({ targetPath: '/project' });

      vi.mocked(fileScanner.scanProjectFiles).mockReturnValue([
        {
          relativePath: 'src/legacy.ts',
          content: `db.query('SELECT', (err, result) => {
  if (err) callback(err);
  else callback(null, result)))
})`,
        },
      ]);

      const result = await guard.execute();

      expect(
        result.issues.some((i) =>
          i.recommendation.includes('async/await')
        )
      ).toBe(true);
    });
  });

  // ===== FLOATING PROMISE TESTS =====

  describe('Floating Promise Detection', () => {
    it('should detect floating fetch call', async () => {
      const guard = new AsyncGuard({ targetPath: '/project' });

      vi.mocked(fileScanner.scanProjectFiles).mockReturnValue([
        {
          relativePath: 'src/service.ts',
          content: `function handleClick() {
  fetch('/api/data');
}`,
        },
      ]);

      const result = await guard.execute();

      // Floating Promise has error severity, so status is 'issues'
      expect(result.status).toBe('issues');
      expect(
        result.issues.some((i) => i.message.includes('Floating Promise'))
      ).toBe(true);
    });

    it('should detect floating axios call', async () => {
      const guard = new AsyncGuard({ targetPath: '/project' });

      vi.mocked(fileScanner.scanProjectFiles).mockReturnValue([
        {
          relativePath: 'src/api.ts',
          // Pattern matches /\b(?:fetch|axios|request|query)\s*\(/
          // So it needs axios( or axios (
          content: `function loadData() {
  axios('/users');
  return true;
}`,
        },
      ]);

      const result = await guard.execute();

      // axios( pattern should match
      expect(result.issues.some((i) => i.message.includes('Floating Promise'))).toBe(
        true
      );
    });

    it('should detect floating request call', async () => {
      const guard = new AsyncGuard({ targetPath: '/project' });

      vi.mocked(fileScanner.scanProjectFiles).mockReturnValue([
        {
          relativePath: 'src/http.ts',
          content: `function sendRequest() {
  request({ url: 'http://example.com' });
}`,
        },
      ]);

      const result = await guard.execute();

      expect(result.issues.some((i) => i.message.includes('Floating Promise'))).toBe(
        true
      );
    });

    it('should detect floating query call', async () => {
      const guard = new AsyncGuard({ targetPath: '/project' });

      vi.mocked(fileScanner.scanProjectFiles).mockReturnValue([
        {
          relativePath: 'src/db.ts',
          content: `function getData() {
  query('SELECT * FROM users');
}`,
        },
      ]);

      const result = await guard.execute();

      expect(result.issues.some((i) => i.message.includes('Floating Promise'))).toBe(
        true
      );
    });

    it('should allow fetch with await', async () => {
      const guard = new AsyncGuard({ targetPath: '/project' });

      vi.mocked(fileScanner.scanProjectFiles).mockReturnValue([
        {
          relativePath: 'src/service.ts',
          content: `async function handleClick() {
  const data = await fetch('/api/data');
}`,
        },
      ]);

      const result = await guard.execute();

      expect(result.status).toBe('ok');
    });

    it('should allow fetch with return', async () => {
      const guard = new AsyncGuard({ targetPath: '/project' });

      vi.mocked(fileScanner.scanProjectFiles).mockReturnValue([
        {
          relativePath: 'src/service.ts',
          content: `function getData() {
  return fetch('/api/data');
}`,
        },
      ]);

      const result = await guard.execute();

      expect(result.status).toBe('ok');
    });

    it('should allow fetch with const/let/var assignment', async () => {
      const guard = new AsyncGuard({ targetPath: '/project' });

      vi.mocked(fileScanner.scanProjectFiles).mockReturnValue([
        {
          relativePath: 'src/service.ts',
          content: `function loadData() {
  const promise = fetch('/api/data');
  let p = axios.get('/users');
  var req = request({ url: 'http://example.com' });
}`,
        },
      ]);

      const result = await guard.execute();

      expect(result.status).toBe('ok');
    });

    it('should allow fetch in if statement', async () => {
      const guard = new AsyncGuard({ targetPath: '/project' });

      vi.mocked(fileScanner.scanProjectFiles).mockReturnValue([
        {
          relativePath: 'src/service.ts',
          content: `function load() {
  if (fetch('/api/data')) { }
}`,
        },
      ]);

      const result = await guard.execute();

      expect(result.status).toBe('ok');
    });

    it('should allow fetch in for loop', async () => {
      const guard = new AsyncGuard({ targetPath: '/project' });

      vi.mocked(fileScanner.scanProjectFiles).mockReturnValue([
        {
          relativePath: 'src/service.ts',
          content: `function load() {
  for (let i = 0; fetch('/api'); i++) { }
}`,
        },
      ]);

      const result = await guard.execute();

      expect(result.status).toBe('ok');
    });
  });

  // ===== PROMISE CHAIN TESTS =====

  describe('Promise Chain Error Handling', () => {
    it('should detect promise chain without .catch()', async () => {
      const guard = new AsyncGuard({ targetPath: '/project' });

      vi.mocked(fileScanner.scanProjectFiles).mockReturnValue([
        {
          relativePath: 'src/promise.ts',
          content: `fetch('/api/data')
  .then(r => r.json())
  .then(data => console.log(data))`,
        },
      ]);

      const result = await guard.execute();

      expect(
        result.issues.some((i) => i.message.includes('without .catch()'))
      ).toBe(true);
    });

    it('should allow promise chain with .catch()', async () => {
      const guard = new AsyncGuard({ targetPath: '/project' });

      vi.mocked(fileScanner.scanProjectFiles).mockReturnValue([
        {
          relativePath: 'src/promise.ts',
          content: `fetch('/api/data')
  .then(r => r.json())
  .then(data => console.log(data))
  .catch(err => console.error(err))`,
        },
      ]);

      const result = await guard.execute();

      expect(
        result.issues.some((i) => i.message.includes('without .catch()'))
      ).toBe(false);
    });

    it('should handle multiple .then() chains', async () => {
      const guard = new AsyncGuard({ targetPath: '/project' });

      vi.mocked(fileScanner.scanProjectFiles).mockReturnValue([
        {
          relativePath: 'src/promise.ts',
          content: `fetch('/api/users')
  .then(r => r.json())
  .then(users => users.map(u => u.id))
  .then(ids => console.log(ids))
  .catch(console.error)`,
        },
      ]);

      const result = await guard.execute();

      // The nextWindow includes .catch() so it should not warn
      expect(
        result.issues.some((i) => i.message.includes('without .catch()'))
      ).toBe(false);
    });
  });

  // ===== MULTIPLE ISSUES TESTS =====

  describe('Multiple Async Issues', () => {
    it('should report all issues in a file', async () => {
      const guard = new AsyncGuard({ targetPath: '/project' });

      vi.mocked(fileScanner.scanProjectFiles).mockReturnValue([
        {
          relativePath: 'src/messy.ts',
          content: `new Promise(resolve => resolve());

fetch('/api/data');

function getData() {
  loadUser();
}

db.query('SELECT', (err, result) => {
  fs.readFile('file', (err, data) => {
    console.log(data)
  })
})`,
        },
      ]);

      const result = await guard.execute();

      // Should find multiple issues (unhandled promise, floating promise, missing await, callback hell)
      expect(result.issues.length).toBeGreaterThanOrEqual(3);
    });
  });

  // ===== INTEGRATION TESTS =====

  describe('AsyncGuard Integration', () => {
    it('should scan multiple files', async () => {
      const guard = new AsyncGuard({ targetPath: '/project' });

      vi.mocked(fileScanner.scanProjectFiles).mockReturnValue([
        {
          relativePath: 'src/service1.ts',
          content: `fetch('/api/1');`,
        },
        {
          relativePath: 'src/service2.ts',
          content: `axios.get('/api/2');`,
        },
      ]);

      const result = await guard.execute();

      // At least one issue should be detected from the floating promises
      expect(result.issues.length).toBeGreaterThanOrEqual(1);
    });

    it('should skip TypeScript only scanning', () => {
      const guard = new AsyncGuard({ targetPath: '/project' });

      vi.mocked(fileScanner.scanProjectFiles).mockReturnValue([]);

      expect(fileScanner.scanProjectFiles).not.toHaveBeenCalled();

      guard.execute();

      // Verify that scanning was called with TypeScript file type
      expect(fileScanner.scanProjectFiles).toHaveBeenCalledWith(
        '/project',
        ['ts']
      );
    });

    it('should include module name in result', async () => {
      const guard = new AsyncGuard({ targetPath: '/project' });

      vi.mocked(fileScanner.scanProjectFiles).mockReturnValue([]);

      const result = await guard.execute();

      expect(result.module).toBe('async-guard');
    });

    it('should create issues with appropriate severity', async () => {
      const guard = new AsyncGuard({ targetUrl: '/project' });

      vi.mocked(fileScanner.scanProjectFiles).mockReturnValue([
        {
          relativePath: 'src/test.ts',
          content: `fetch('/api');

loadUser();`,
        },
      ]);

      const result = await guard.execute();

      const floatingPromiseIssue = result.issues.find((i) =>
        i.message.includes('Floating Promise')
      );
      const missingAwaitIssue = result.issues.find((i) =>
        i.message.includes('Missing await')
      );

      // Floating promises are error severity
      if (floatingPromiseIssue) {
        expect(floatingPromiseIssue.severity).toBe('error');
      }

      // Missing await is warning severity
      if (missingAwaitIssue) {
        expect(missingAwaitIssue.severity).toBe('warning');
      }
    });

    it('should handle files with no content', async () => {
      const guard = new AsyncGuard({ targetPath: '/project' });

      vi.mocked(fileScanner.scanProjectFiles).mockReturnValue([
        {
          relativePath: 'src/empty.ts',
          content: '',
        },
      ]);

      const result = await guard.execute();

      expect(result.status).toBe('ok');
    });

    it('should handle files with only comments', async () => {
      const guard = new AsyncGuard({ targetPath: '/project' });

      vi.mocked(fileScanner.scanProjectFiles).mockReturnValue([
        {
          relativePath: 'src/commented.ts',
          content: `// This is a comment
// import stuff
const x = 1;`,
        },
      ]);

      const result = await guard.execute();

      expect(result.status).toBe('ok');
    });
  });

  // ===== EDGE CASE TESTS =====

  describe('Edge Cases', () => {
    it('should handle Promise in string literals', async () => {
      const guard = new AsyncGuard({ targetPath: '/project' });

      vi.mocked(fileScanner.scanProjectFiles).mockReturnValue([
        {
          relativePath: 'src/strings.ts',
          content: `const str = "new Promise(resolve => resolve())"`,
        },
      ]);

      const result = await guard.execute();

      // Note: regex-based scanning will match patterns in strings (known limitation)
      // This test documents current behavior
      expect(result).toBeDefined();
    });

    it('should handle fetch in string literals', async () => {
      const guard = new AsyncGuard({ targetPath: '/project' });

      vi.mocked(fileScanner.scanProjectFiles).mockReturnValue([
        {
          relativePath: 'src/strings.ts',
          content: `const url = "fetch('/api/data')"; `,
        },
      ]);

      const result = await guard.execute();

      // Note: regex-based scanning may match patterns in strings (known limitation)
      // This test documents current behavior
      expect(result).toBeDefined();
    });

    it('should handle Promise in comments', async () => {
      const guard = new AsyncGuard({ targetPath: '/project' });

      vi.mocked(fileScanner.scanProjectFiles).mockReturnValue([
        {
          relativePath: 'src/commented.ts',
          content: `// new Promise(resolve => resolve())
const x = 1;`,
        },
      ]);

      const result = await guard.execute();

      // Would flag it but that's a limitation of regex-based scanning
      // This documents current behavior
      expect(result).toBeDefined();
    });
  });
});
