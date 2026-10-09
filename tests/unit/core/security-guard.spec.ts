/**
 * @file tests/unit/core/security-guard.spec.ts
 * @description Comprehensive test suite for SecurityGuard with full HTTP mocking
 *
 * Tests cover:
 * - Required security headers validation
 * - Recommended headers detection
 * - HSTS max-age verification
 * - CSP directive analysis
 * - X-Frame-Options validation
 * - HTTP vs HTTPS enforcement
 * - Network errors and timeouts
 * - SecurityGuard class execution
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import http from 'http';
import https from 'https';
import { SecurityGuard } from '../../../src/core/security-guard.js';

// Mock HTTP/HTTPS modules
vi.mock('http');
vi.mock('https');

interface MockResponse {
  headers: Record<string, string | string[] | undefined>;
  on: (event: string, callback: (err?: Error) => void) => void;
  statusCode?: number;
}

interface MockRequest {
  on: (event: string, callback: (err?: Error) => void) => void;
  destroy: () => void;
  end: () => void;
}

describe('SecurityGuard', () => {
  let mockRequest: Partial<MockRequest>;
  let mockResponse: Partial<MockResponse>;
  let responseCallbacks: Record<string, (err?: Error) => void> = {};
  let requestCallbacks: Record<string, (err?: Error) => void> = {};

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();

    // Setup mock request and response
    mockRequest = {
      on: vi.fn(function (event: string, callback: (err?: Error) => void) {
        requestCallbacks[event] = callback;
        return this;
      }),
      destroy: vi.fn(),
      end: vi.fn(),
    };

    mockResponse = {
      headers: {},
      on: vi.fn(function (event: string, callback: (err?: Error) => void) {
        responseCallbacks[event] = callback;
        return this;
      }),
      statusCode: 200,
    };

    // Reset callback storage
    responseCallbacks = {};
    requestCallbacks = {};
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ===== HEADER VALIDATION TESTS =====

  describe('Required Headers Validation', () => {
    it('should detect missing content-security-policy header', async () => {
      const guard = new SecurityGuard({ targetUrl: 'https://example.com' });

      // Setup mock with minimal headers
      mockResponse.headers = {
        'x-frame-options': 'DENY',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'strict-origin-when-cross-origin',
        'strict-transport-security': 'max-age=31536000',
      };

      // Mock https.request
      vi.mocked(https.request).mockImplementation((url, options, callback) => {
        // Call the callback with our mock response
        if (typeof callback === 'function') {
          callback(mockResponse as http.IncomingMessage);
        }
        return mockRequest as http.ClientRequest;
      });

      const result = await guard.execute();

      expect(result.status).toBe('issues');
      expect(result.issues.length).toBeGreaterThan(0);
      expect(
        result.issues.some((i) => i.message.includes('Missing security header'))
      ).toBe(true);
    });

    it('should detect all missing required headers', async () => {
      const guard = new SecurityGuard({ targetUrl: 'https://example.com' });

      // Setup mock with NO security headers
      mockResponse.headers = {};

      vi.mocked(https.request).mockImplementation((url, options, callback) => {
        if (typeof callback === 'function') {
          callback(mockResponse as http.IncomingMessage);
        }
        return mockRequest as http.ClientRequest;
      });

      const result = await guard.execute();

      expect(result.status).toBe('issues');
      // Should find issues for all 5 required headers
      expect(result.issues.length).toBeGreaterThanOrEqual(5);
    });

    it('should pass with all required headers present', async () => {
      const guard = new SecurityGuard({ targetUrl: 'https://example.com' });

      mockResponse.headers = {
        'content-security-policy': "default-src 'self'; script-src 'self'; font-src 'self'; img-src 'self' https:; style-src 'self'; connect-src 'self'; frame-ancestors 'none'",
        'x-frame-options': 'DENY',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'strict-origin-when-cross-origin',
        'strict-transport-security': 'max-age=31536000',
        'permissions-policy': 'geolocation=()',
        'cross-origin-embedder-policy': 'require-corp',
        'cross-origin-opener-policy': 'same-origin',
      };

      vi.mocked(https.request).mockImplementation((url, options, callback) => {
        if (typeof callback === 'function') {
          callback(mockResponse as http.IncomingMessage);
        }
        return mockRequest as http.ClientRequest;
      });

      const result = await guard.execute();

      expect(result.status).toBe('ok');
      expect(result.issues.length).toBe(0);
    });
  });

  // ===== RECOMMENDED HEADERS TESTS =====

  describe('Recommended Headers Detection', () => {
    it('should detect missing permissions-policy header', async () => {
      const guard = new SecurityGuard({ targetUrl: 'https://example.com' });

      mockResponse.headers = {
        'content-security-policy': "default-src 'self'; script-src 'self'; font-src 'self'; img-src 'self' https:; style-src 'self'; connect-src 'self'; frame-ancestors 'none'",
        'x-frame-options': 'DENY',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'strict-origin-when-cross-origin',
        'strict-transport-security': 'max-age=31536000',
        // Missing recommended headers
      };

      vi.mocked(https.request).mockImplementation((url, options, callback) => {
        if (typeof callback === 'function') {
          callback(mockResponse as http.IncomingMessage);
        }
        return mockRequest as http.ClientRequest;
      });

      const result = await guard.execute();

      // Missing recommended headers results in warning status
      expect(result.status).toBe('warning');
      expect(
        result.issues.some((i) => i.message.includes('Missing recommended header'))
      ).toBe(true);
    });

    it('should pass with all recommended headers', async () => {
      const guard = new SecurityGuard({ targetUrl: 'https://example.com' });

      mockResponse.headers = {
        'content-security-policy': "default-src 'self'; script-src 'self'; font-src 'self'; img-src 'self' https:; style-src 'self'; connect-src 'self'; frame-ancestors 'none'",
        'x-frame-options': 'DENY',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'strict-origin-when-cross-origin',
        'strict-transport-security': 'max-age=31536000',
        'permissions-policy': 'geolocation=()',
        'cross-origin-embedder-policy': 'require-corp',
        'cross-origin-opener-policy': 'same-origin',
      };

      vi.mocked(https.request).mockImplementation((url, options, callback) => {
        if (typeof callback === 'function') {
          callback(mockResponse as http.IncomingMessage);
        }
        return mockRequest as http.ClientRequest;
      });

      const result = await guard.execute();

      expect(result.status).toBe('ok');
    });
  });

  // ===== HSTS VALIDATION TESTS =====

  describe('HSTS Max-Age Validation', () => {
    it('should warn when HSTS max-age is too low', async () => {
      const guard = new SecurityGuard({ targetUrl: 'https://example.com' });

      mockResponse.headers = {
        'content-security-policy': "default-src 'self'; script-src 'self'; font-src 'self'; img-src 'self' https:; style-src 'self'; connect-src 'self'; frame-ancestors 'none'",
        'x-frame-options': 'DENY',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'strict-origin-when-cross-origin',
        'strict-transport-security': 'max-age=86400', // 1 day - too low
        'permissions-policy': 'geolocation=()',
        'cross-origin-embedder-policy': 'require-corp',
        'cross-origin-opener-policy': 'same-origin',
      };

      vi.mocked(https.request).mockImplementation((url, options, callback) => {
        if (typeof callback === 'function') {
          callback(mockResponse as http.IncomingMessage);
        }
        return mockRequest as http.ClientRequest;
      });

      const result = await guard.execute();

      expect(result.status).toBe('warning');
      expect(
        result.issues.some((i) => i.message.includes('HSTS max-age too low'))
      ).toBe(true);
    });

    it('should pass when HSTS max-age meets minimum (1 year)', async () => {
      const guard = new SecurityGuard({ targetUrl: 'https://example.com' });

      mockResponse.headers = {
        'content-security-policy': "default-src 'self'; script-src 'self'; font-src 'self'; img-src 'self' https:; style-src 'self'; connect-src 'self'; frame-ancestors 'none'",
        'x-frame-options': 'DENY',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'strict-origin-when-cross-origin',
        'strict-transport-security': 'max-age=31536000', // 1 year
        'permissions-policy': 'geolocation=()',
        'cross-origin-embedder-policy': 'require-corp',
        'cross-origin-opener-policy': 'same-origin',
      };

      vi.mocked(https.request).mockImplementation((url, options, callback) => {
        if (typeof callback === 'function') {
          callback(mockResponse as http.IncomingMessage);
        }
        return mockRequest as http.ClientRequest;
      });

      const result = await guard.execute();

      expect(result.status).toBe('ok');
    });

    it('should handle HSTS without max-age gracefully', async () => {
      const guard = new SecurityGuard({ targetUrl: 'https://example.com' });

      mockResponse.headers = {
        'content-security-policy': "default-src 'self'",
        'x-frame-options': 'DENY',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'strict-origin-when-cross-origin',
        'strict-transport-security': 'includeSubDomains', // No max-age
        'permissions-policy': 'geolocation=()',
        'cross-origin-embedder-policy': 'require-corp',
        'cross-origin-opener-policy': 'same-origin',
      };

      vi.mocked(https.request).mockImplementation((url, options, callback) => {
        if (typeof callback === 'function') {
          callback(mockResponse as http.IncomingMessage);
        }
        return mockRequest as http.ClientRequest;
      });

      const result = await guard.execute();

      // Should not crash - it's still acceptable
      expect(result).toBeDefined();
    });
  });

  // ===== CSP VALIDATION TESTS =====

  describe('CSP Directive Validation', () => {
    it('should detect unsafe-inline in CSP', async () => {
      const guard = new SecurityGuard({ targetUrl: 'https://example.com' });

      mockResponse.headers = {
        'content-security-policy': "default-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self'; img-src 'self' https:; style-src 'self'; connect-src 'self'; frame-ancestors 'none'",
        'x-frame-options': 'DENY',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'strict-origin-when-cross-origin',
        'strict-transport-security': 'max-age=31536000',
        'permissions-policy': 'geolocation=()',
        'cross-origin-embedder-policy': 'require-corp',
        'cross-origin-opener-policy': 'same-origin',
      };

      vi.mocked(https.request).mockImplementation((url, options, callback) => {
        if (typeof callback === 'function') {
          callback(mockResponse as http.IncomingMessage);
        }
        return mockRequest as http.ClientRequest;
      });

      const result = await guard.execute();

      expect(result.status).toBe('warning');
      expect(
        result.issues.some((i) => i.message.includes('unsafe directives'))
      ).toBe(true);
    });

    it('should detect unsafe-eval in CSP', async () => {
      const guard = new SecurityGuard({ targetUrl: 'https://example.com' });

      mockResponse.headers = {
        'content-security-policy': "default-src 'self'; script-src 'unsafe-eval'; font-src 'self'; img-src 'self' https:; style-src 'self'; connect-src 'self'; frame-ancestors 'none'",
        'x-frame-options': 'DENY',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'strict-origin-when-cross-origin',
        'strict-transport-security': 'max-age=31536000',
        'permissions-policy': 'geolocation=()',
        'cross-origin-embedder-policy': 'require-corp',
        'cross-origin-opener-policy': 'same-origin',
      };

      vi.mocked(https.request).mockImplementation((url, options, callback) => {
        if (typeof callback === 'function') {
          callback(mockResponse as http.IncomingMessage);
        }
        return mockRequest as http.ClientRequest;
      });

      const result = await guard.execute();

      expect(result.status).toBe('warning');
      expect(
        result.issues.some((i) => i.message.includes('unsafe directives'))
      ).toBe(true);
    });

    it('should detect missing default-src and script-src in CSP', async () => {
      const guard = new SecurityGuard({ targetUrl: 'https://example.com' });

      mockResponse.headers = {
        'content-security-policy': 'img-src https:',
        'x-frame-options': 'DENY',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'strict-origin-when-cross-origin',
        'strict-transport-security': 'max-age=31536000',
        'permissions-policy': 'geolocation=()',
        'cross-origin-embedder-policy': 'require-corp',
        'cross-origin-opener-policy': 'same-origin',
      };

      vi.mocked(https.request).mockImplementation((url, options, callback) => {
        if (typeof callback === 'function') {
          callback(mockResponse as http.IncomingMessage);
        }
        return mockRequest as http.ClientRequest;
      });

      const result = await guard.execute();

      expect(result.status).toBe('warning');
      expect(
        result.issues.some((i) =>
          i.message.includes('missing default-src or script-src')
        )
      ).toBe(true);
    });

    it('should detect missing critical CSP directives', async () => {
      const guard = new SecurityGuard({ targetUrl: 'https://example.com' });

      mockResponse.headers = {
        'content-security-policy': "default-src 'self'; script-src 'self'",
        'x-frame-options': 'DENY',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'strict-origin-when-cross-origin',
        'strict-transport-security': 'max-age=31536000',
        'permissions-policy': 'geolocation=()',
        'cross-origin-embedder-policy': 'require-corp',
        'cross-origin-opener-policy': 'same-origin',
      };

      vi.mocked(https.request).mockImplementation((url, options, callback) => {
        if (typeof callback === 'function') {
          callback(mockResponse as http.IncomingMessage);
        }
        return mockRequest as http.ClientRequest;
      });

      const result = await guard.execute();

      expect(result.status).toBe('warning');
      expect(
        result.issues.some((i) =>
          i.message.includes('missing recommended directives')
        )
      ).toBe(true);
    });

    it('should detect script-src set to none', async () => {
      const guard = new SecurityGuard({ targetUrl: 'https://example.com' });

      mockResponse.headers = {
        'content-security-policy': "default-src 'self'; script-src 'none'; font-src 'self'; img-src 'self' https:; style-src 'self'; connect-src 'self'; frame-ancestors 'none'",
        'x-frame-options': 'DENY',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'strict-origin-when-cross-origin',
        'strict-transport-security': 'max-age=31536000',
        'permissions-policy': 'geolocation=()',
        'cross-origin-embedder-policy': 'require-corp',
        'cross-origin-opener-policy': 'same-origin',
      };

      vi.mocked(https.request).mockImplementation((url, options, callback) => {
        if (typeof callback === 'function') {
          callback(mockResponse as http.IncomingMessage);
        }
        return mockRequest as http.ClientRequest;
      });

      const result = await guard.execute();

      expect(result.status).toBe('warning');
      expect(
        result.issues.some((i) => i.message.includes('script-src is set to'))
      ).toBe(true);
    });

    it('should pass with comprehensive CSP policy', async () => {
      const guard = new SecurityGuard({ targetUrl: 'https://example.com' });

      mockResponse.headers = {
        'content-security-policy':
          "default-src 'self'; script-src 'self' 'nonce-abc123'; font-src 'self'; img-src 'self' https:; style-src 'self'; connect-src 'self'; frame-ancestors 'none'",
        'x-frame-options': 'DENY',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'strict-origin-when-cross-origin',
        'strict-transport-security': 'max-age=31536000',
        'permissions-policy': 'geolocation=()',
        'cross-origin-embedder-policy': 'require-corp',
        'cross-origin-opener-policy': 'same-origin',
      };

      vi.mocked(https.request).mockImplementation((url, options, callback) => {
        if (typeof callback === 'function') {
          callback(mockResponse as http.IncomingMessage);
        }
        return mockRequest as http.ClientRequest;
      });

      const result = await guard.execute();

      expect(result.status).toBe('ok');
    });
  });

  // ===== X-FRAME-OPTIONS VALIDATION TESTS =====

  describe('X-Frame-Options Validation', () => {
    it('should pass with X-Frame-Options: DENY', async () => {
      const guard = new SecurityGuard({ targetUrl: 'https://example.com' });

      mockResponse.headers = {
        'content-security-policy': "default-src 'self'; script-src 'self'; font-src 'self'; img-src 'self' https:; style-src 'self'; connect-src 'self'; frame-ancestors 'none'",
        'x-frame-options': 'DENY',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'strict-origin-when-cross-origin',
        'strict-transport-security': 'max-age=31536000',
        'permissions-policy': 'geolocation=()',
        'cross-origin-embedder-policy': 'require-corp',
        'cross-origin-opener-policy': 'same-origin',
      };

      vi.mocked(https.request).mockImplementation((url, options, callback) => {
        if (typeof callback === 'function') {
          callback(mockResponse as http.IncomingMessage);
        }
        return mockRequest as http.ClientRequest;
      });

      const result = await guard.execute();

      expect(result.status).toBe('ok');
    });

    it('should pass with X-Frame-Options: SAMEORIGIN', async () => {
      const guard = new SecurityGuard({ targetUrl: 'https://example.com' });

      mockResponse.headers = {
        'content-security-policy': "default-src 'self'; script-src 'self'; font-src 'self'; img-src 'self' https:; style-src 'self'; connect-src 'self'; frame-ancestors 'none'",
        'x-frame-options': 'SAMEORIGIN',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'strict-origin-when-cross-origin',
        'strict-transport-security': 'max-age=31536000',
        'permissions-policy': 'geolocation=()',
        'cross-origin-embedder-policy': 'require-corp',
        'cross-origin-opener-policy': 'same-origin',
      };

      vi.mocked(https.request).mockImplementation((url, options, callback) => {
        if (typeof callback === 'function') {
          callback(mockResponse as http.IncomingMessage);
        }
        return mockRequest as http.ClientRequest;
      });

      const result = await guard.execute();

      expect(result.status).toBe('ok');
    });

    it('should detect weak X-Frame-Options value', async () => {
      const guard = new SecurityGuard({ targetUrl: 'https://example.com' });

      mockResponse.headers = {
        'content-security-policy': "default-src 'self'",
        'x-frame-options': 'ALLOW-FROM https://example.com',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'strict-origin-when-cross-origin',
        'strict-transport-security': 'max-age=31536000',
        'permissions-policy': 'geolocation=()',
        'cross-origin-embedder-policy': 'require-corp',
        'cross-origin-opener-policy': 'same-origin',
      };

      vi.mocked(https.request).mockImplementation((url, options, callback) => {
        if (typeof callback === 'function') {
          callback(mockResponse as http.IncomingMessage);
        }
        return mockRequest as http.ClientRequest;
      });

      const result = await guard.execute();

      // Weak value is just a warning, not an error
      expect(result.status).toBe('warning');
      expect(
        result.issues.some((i) => i.message.includes('X-Frame-Options has weak value'))
      ).toBe(true);
    });
  });

  // ===== HTTPS ENFORCEMENT TESTS =====

  describe('HTTPS Enforcement', () => {
    it('should warn for remote host without HTTPS', async () => {
      const guard = new SecurityGuard({ targetUrl: 'http://example.com' });

      mockResponse.headers = {
        'content-security-policy': "default-src 'self'",
        'x-frame-options': 'DENY',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'strict-origin-when-cross-origin',
        'strict-transport-security': 'max-age=31536000',
        'permissions-policy': 'geolocation=()',
        'cross-origin-embedder-policy': 'require-corp',
        'cross-origin-opener-policy': 'same-origin',
      };

      vi.mocked(http.request).mockImplementation((url, options, callback) => {
        if (typeof callback === 'function') {
          callback(mockResponse as http.IncomingMessage);
        }
        return mockRequest as http.ClientRequest;
      });

      const result = await guard.execute();

      // "not HTTPS" is critical severity, so status is 'error'
      expect(result.status).toBe('error');
      expect(
        result.issues.some((i) => i.message.includes('not HTTPS'))
      ).toBe(true);
    });

    it('should allow localhost with HTTP', async () => {
      const guard = new SecurityGuard({ targetUrl: 'http://localhost:3000' });

      mockResponse.headers = {
        'content-security-policy': "default-src 'self'",
        'x-frame-options': 'DENY',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'strict-origin-when-cross-origin',
        'strict-transport-security': 'max-age=31536000',
        'permissions-policy': 'geolocation=()',
        'cross-origin-embedder-policy': 'require-corp',
        'cross-origin-opener-policy': 'same-origin',
      };

      vi.mocked(http.request).mockImplementation((url, options, callback) => {
        if (typeof callback === 'function') {
          callback(mockResponse as http.IncomingMessage);
        }
        return mockRequest as http.ClientRequest;
      });

      const result = await guard.execute();

      // Should not complain about HTTP for localhost
      expect(
        result.issues.some((i) => i.message.includes('not HTTPS'))
      ).toBe(false);
    });

    it('should allow 127.0.0.1 with HTTP', async () => {
      const guard = new SecurityGuard({ targetUrl: 'http://127.0.0.1:8080' });

      mockResponse.headers = {
        'content-security-policy': "default-src 'self'",
        'x-frame-options': 'DENY',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'strict-origin-when-cross-origin',
        'strict-transport-security': 'max-age=31536000',
        'permissions-policy': 'geolocation=()',
        'cross-origin-embedder-policy': 'require-corp',
        'cross-origin-opener-policy': 'same-origin',
      };

      vi.mocked(http.request).mockImplementation((url, options, callback) => {
        if (typeof callback === 'function') {
          callback(mockResponse as http.IncomingMessage);
        }
        return mockRequest as http.ClientRequest;
      });

      const result = await guard.execute();

      expect(
        result.issues.some((i) => i.message.includes('not HTTPS'))
      ).toBe(false);
    });

    it('should handle IPv6 localhost addresses', async () => {
      // Note: URL API parses [::1] with brackets, which doesn't match the ::1 check
      // This test documents the current behavior
      const guard = new SecurityGuard({ targetUrl: 'http://[::1]:8080' });

      mockResponse.headers = {
        'content-security-policy': "default-src 'self'",
        'x-frame-options': 'DENY',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'strict-origin-when-cross-origin',
        'strict-transport-security': 'max-age=31536000',
        'permissions-policy': 'geolocation=()',
        'cross-origin-embedder-policy': 'require-corp',
        'cross-origin-opener-policy': 'same-origin',
      };

      vi.mocked(http.request).mockImplementation((url, options, callback) => {
        if (typeof callback === 'function') {
          callback(mockResponse as http.IncomingMessage);
        }
        return mockRequest as http.ClientRequest;
      });

      const result = await guard.execute();

      // IPv6 addresses in brackets are treated as remote hosts due to URL parsing
      // This is a known limitation - they trigger HTTPS warning
      expect(result.status).toBe('error');
    });
  });

  // ===== ERROR HANDLING TESTS =====

  describe('Network Error Handling', () => {
    it('should handle request errors gracefully', async () => {
      const guard = new SecurityGuard({ targetUrl: 'https://example.com' });

      vi.mocked(https.request).mockImplementation((_url, _options, _callback) => {
        // Trigger error callback asynchronously
        setTimeout(() => {
          if (requestCallbacks['error']) {
            requestCallbacks['error'](new Error('Connection refused'));
          }
        }, 0);
        return mockRequest as http.ClientRequest;
      });

      const result = await guard.execute();

      // Error in the request creates a critical issue, so status is 'error'
      expect(result.status).toBe('error');
      expect(
        result.issues.some((i) => i.message.includes('Security audit request failed'))
      ).toBe(true);
    });

    it('should handle request timeout', async () => {
      const guard = new SecurityGuard({ targetUrl: 'https://example.com' });

      vi.mocked(https.request).mockImplementation((_url, _options, _callback) => {
        setTimeout(() => {
          if (requestCallbacks['timeout']) {
            requestCallbacks['timeout']();
          }
        }, 0);
        return mockRequest as http.ClientRequest;
      });

      const result = await guard.execute();

      // Timeout creates a critical issue, so status is 'error'
      expect(result.status).toBe('error');
      expect(
        result.issues.some((i) => i.message.includes('timed out'))
      ).toBe(true);
      expect(mockRequest.destroy).toHaveBeenCalled();
    });

    it('should set request timeout to 10 seconds', async () => {
      const guard = new SecurityGuard({ targetUrl: 'https://example.com' });

      let capturedOptions: Record<string, unknown> | undefined;

      vi.mocked(https.request).mockImplementation((url, options, callback) => {
        capturedOptions = options as Record<string, unknown>;
        if (typeof callback === 'function') {
          callback(mockResponse as http.IncomingMessage);
        }
        return mockRequest as http.ClientRequest;
      });

      mockResponse.headers = {
        'content-security-policy': "default-src 'self'",
        'x-frame-options': 'DENY',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'strict-origin-when-cross-origin',
        'strict-transport-security': 'max-age=31536000',
        'permissions-policy': 'geolocation=()',
        'cross-origin-embedder-policy': 'require-corp',
        'cross-origin-opener-policy': 'same-origin',
      };

      await guard.execute();

      expect(capturedOptions?.timeout).toBe(10000);
    });

    it('should use HEAD method for request', async () => {
      const guard = new SecurityGuard({ targetUrl: 'https://example.com' });

      let capturedOptions: Record<string, unknown> | undefined;

      vi.mocked(https.request).mockImplementation((url, options, callback) => {
        capturedOptions = options as Record<string, unknown>;
        if (typeof callback === 'function') {
          callback(mockResponse as http.IncomingMessage);
        }
        return mockRequest as http.ClientRequest;
      });

      mockResponse.headers = {
        'content-security-policy': "default-src 'self'",
        'x-frame-options': 'DENY',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'strict-origin-when-cross-origin',
        'strict-transport-security': 'max-age=31536000',
        'permissions-policy': 'geolocation=()',
        'cross-origin-embedder-policy': 'require-corp',
        'cross-origin-opener-policy': 'same-origin',
      };

      await guard.execute();

      expect(capturedOptions?.method).toBe('HEAD');
    });
  });

  // ===== SECURITY SCORING TESTS =====

  describe('Security Scoring', () => {
    it('should calculate perfect score with all headers', async () => {
      const guard = new SecurityGuard({ targetUrl: 'https://example.com' });

      mockResponse.headers = {
        'content-security-policy': "default-src 'self'; script-src 'self'; font-src 'self'; img-src 'self' https:; style-src 'self'; connect-src 'self'; frame-ancestors 'none'",
        'x-frame-options': 'DENY',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'strict-origin-when-cross-origin',
        'strict-transport-security': 'max-age=31536000',
        'permissions-policy': 'geolocation=()',
        'cross-origin-embedder-policy': 'require-corp',
        'cross-origin-opener-policy': 'same-origin',
      };

      vi.mocked(https.request).mockImplementation((url, options, callback) => {
        if (typeof callback === 'function') {
          callback(mockResponse as http.IncomingMessage);
        }
        return mockRequest as http.ClientRequest;
      });

      const result = await guard.execute();

      expect(result.status).toBe('ok');
      expect(result.message).toContain('score 100/100');
    });

    it('should reduce score for missing headers', async () => {
      const guard = new SecurityGuard({ targetUrl: 'https://example.com' });

      mockResponse.headers = {
        'content-security-policy': "default-src 'self'",
        'x-frame-options': 'DENY',
        // Missing other headers
      };

      vi.mocked(https.request).mockImplementation((url, options, callback) => {
        if (typeof callback === 'function') {
          callback(mockResponse as http.IncomingMessage);
        }
        return mockRequest as http.ClientRequest;
      });

      const result = await guard.execute();

      expect(result.status).toBe('issues');
      // Score should be reduced for missing headers
      const scoreMatch = result.message.match(/score (\d+)\/100/);
      if (scoreMatch) {
        const score = parseInt(scoreMatch[1], 10);
        expect(score).toBeLessThan(100);
      }
    });
  });

  // ===== CASE SENSITIVITY TESTS =====

  describe('Header Case Insensitivity', () => {
    it('should detect headers with different casing', async () => {
      const guard = new SecurityGuard({ targetUrl: 'https://example.com' });

      mockResponse.headers = {
        'Content-Security-Policy': "default-src 'self'",
        'X-Frame-Options': 'DENY',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'Strict-Transport-Security': 'max-age=31536000',
        'Permissions-Policy': 'geolocation=()',
        'Cross-Origin-Embedder-Policy': 'require-corp',
        'Cross-Origin-Opener-Policy': 'same-origin',
      };

      vi.mocked(https.request).mockImplementation((url, options, callback) => {
        if (typeof callback === 'function') {
          callback(mockResponse as http.IncomingMessage);
        }
        return mockRequest as http.ClientRequest;
      });

      const result = await guard.execute();

      // Should pass even with different casing
      expect(result.status).toBe('ok');
    });
  });

  // ===== MULTIPLE UNSAFE DIRECTIVES TEST =====

  describe('Multiple CSP Unsafe Directives', () => {
    it('should detect multiple unsafe directives in CSP', async () => {
      const guard = new SecurityGuard({ targetUrl: 'https://example.com' });

      mockResponse.headers = {
        'content-security-policy':
          "default-src 'self' 'unsafe-inline' 'unsafe-eval'; script-src 'unsafe-eval'",
        'x-frame-options': 'DENY',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'strict-origin-when-cross-origin',
        'strict-transport-security': 'max-age=31536000',
        'permissions-policy': 'geolocation=()',
        'cross-origin-embedder-policy': 'require-corp',
        'cross-origin-opener-policy': 'same-origin',
      };

      vi.mocked(https.request).mockImplementation((url, options, callback) => {
        if (typeof callback === 'function') {
          callback(mockResponse as http.IncomingMessage);
        }
        return mockRequest as http.ClientRequest;
      });

      const result = await guard.execute();

      // Will have warning status due to unsafe directives and missing CSP directives
      expect(result.status).toBe('warning');
      const unsafeIssue = result.issues.find((i) =>
        i.message.includes('unsafe directives')
      );
      expect(unsafeIssue).toBeDefined();
    });
  });

  // ===== INTEGRATION TEST =====

  describe('SecurityGuard Class Integration', () => {
    it('should create issues with correct severity levels', async () => {
      const guard = new SecurityGuard({ targetUrl: 'https://example.com' });

      mockResponse.headers = {
        // Missing HTTPS header error and recommended headers
      };

      vi.mocked(https.request).mockImplementation((url, options, callback) => {
        if (typeof callback === 'function') {
          callback(mockResponse as http.IncomingMessage);
        }
        return mockRequest as http.ClientRequest;
      });

      const result = await guard.execute();

      expect(result.status).toBe('issues');
      // Should have issues with appropriate severity
      expect(result.issues.length).toBeGreaterThan(0);
      expect(result.issues[0].severity).toMatch(/critical|error|warning/);
    });

    it('should include module name in result', async () => {
      const guard = new SecurityGuard({ targetUrl: 'https://example.com' });

      mockResponse.headers = {
        'content-security-policy': "default-src 'self'",
        'x-frame-options': 'DENY',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'strict-origin-when-cross-origin',
        'strict-transport-security': 'max-age=31536000',
        'permissions-policy': 'geolocation=()',
        'cross-origin-embedder-policy': 'require-corp',
        'cross-origin-opener-policy': 'same-origin',
      };

      vi.mocked(https.request).mockImplementation((url, options, callback) => {
        if (typeof callback === 'function') {
          callback(mockResponse as http.IncomingMessage);
        }
        return mockRequest as http.ClientRequest;
      });

      const result = await guard.execute();

      expect(result.module).toBe('security-guard');
    });
  });
});
