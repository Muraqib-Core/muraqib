import https from "https";
import http from "http";
import { URL } from "url";
import { BaseGuard } from "./base-guard.js";
import type { AuditResult, AuditIssue, AuditContext } from "./types.js";

/**
 * Result of a security audit on an HTTP endpoint
 * @interface SecurityAuditResult
 */
export interface SecurityAuditResult { // muraqib-ignore-dead: auto-suppressed by script for SecurityAuditResult
  isSecure: boolean;
  reports: string[];
  headers: Record<string, string | string[] | undefined>;
  score: number; // 0-100
}

interface SecurityAuditOptions {
  targetUrl: string;
}

const REQUIRED_HEADERS = [
  "content-security-policy",
  "x-frame-options",
  "x-content-type-options",
  "referrer-policy",
  "strict-transport-security",
];

const RECOMMENDED_HEADERS = [
  "permissions-policy",
  "cross-origin-embedder-policy",
  "cross-origin-opener-policy",
];

async function performSecurityAuditInternal(targetUrl: string): Promise<SecurityAuditResult> {
  const reports: string[] = [];
  const url = new URL(targetUrl);
  const hostname = url.hostname;
  const isLocalHost = ["localhost", "127.0.0.1", "::1"].includes(hostname);
  const isHttps = url.protocol === "https:";

  // For remote hosts, warn if connection is not HTTPS. For localhost (dev) allow HTTP.
  if (!isLocalHost && !isHttps) {
    reports.push("Connection is not HTTPS — data transmitted in plaintext");
  }

  return new Promise((resolve) => {
    const client = isHttps ? https : http;
    const req = client.request(
      targetUrl,
      { method: "HEAD", timeout: 10000 },
      (res) => {
        const headers = res.headers;
        const headerKeys = Object.keys(headers).map((k) => k.toLowerCase());

        // Check required headers
        for (const header of REQUIRED_HEADERS) {
          if (!headerKeys.includes(header)) {
            reports.push(`Missing security header: ${header}`);
          }
        }

        // Check recommended headers
        for (const header of RECOMMENDED_HEADERS) {
          if (!headerKeys.includes(header)) {
            reports.push(`Missing recommended header: ${header}`);
          }
        }

        // Check HSTS
        if (headers["strict-transport-security"]) {
          const hsts = String(headers["strict-transport-security"]);
          const maxAgeMatch = hsts.match(/max-age=(\d+)/);
          if (maxAgeMatch && maxAgeMatch[1]) {
            const maxAge = parseInt(maxAgeMatch[1], 10);
            if (maxAge < 31536000) {
              reports.push(`HSTS max-age too low: ${maxAge}s (recommended: 31536000s)`);
            }
          }
        }

        // Check CSP
        if (headers["content-security-policy"]) {
          const csp = String(headers["content-security-policy"]);

          const unsafeMatches = csp.match(/'unsafe-[^']+'/g) || [];
          if (unsafeMatches.length > 0) {
            reports.push(`CSP contains unsafe directives: ${unsafeMatches.join(', ')}`);
          }

          if (!csp.includes("default-src") && !csp.includes("script-src")) {
            reports.push("CSP missing default-src or script-src directive");
          }

          const criticalDirectives = ["font-src", "img-src", "style-src", "connect-src", "frame-ancestors"];
          const missingDirectives = criticalDirectives.filter(dir => !csp.includes(dir));
          if (missingDirectives.length > 0) {
            reports.push(`CSP missing recommended directives: ${missingDirectives.join(', ')}`);
          }

          if (csp.includes("script-src") && csp.includes("script-src 'none'")) {
            reports.push("CSP script-src is set to 'none', blocking all scripts");
          }
        }

        // Check X-Frame-Options
        if (headers["x-frame-options"]) {
          const xfo = String(headers["x-frame-options"]).toLowerCase();
          if (xfo !== "deny" && xfo !== "sameorigin") {
            reports.push(`X-Frame-Options has weak value: ${xfo}`);
          }
        }

        // Score calculation: each issue costs one point from the total checks
        const totalChecks = REQUIRED_HEADERS.length + RECOMMENDED_HEADERS.length + 3;
        const passedChecks = Math.max(0, totalChecks - reports.length);
        const score = Math.max(0, Math.round((passedChecks / totalChecks) * 100));

        // isSecure is true only when there are NO findings — applies to both
        // localhost and remote hosts. The previous code always returned
        // isSecure=true for non-localhost targets, hiding all header violations.
        const isSecure = reports.length === 0;

        resolve({
          isSecure,
          reports,
          headers,
          score,
        });
      }
    );

    req.on("error", (err) => {
      reports.push(`Security audit request failed: ${err.message}`);
      resolve({
        isSecure: false,
        reports,
        headers: {},
        score: 0,
      });
    });

    req.on("timeout", () => {
      req.destroy();
      reports.push("Security audit request timed out");
      resolve({
        isSecure: false,
        reports,
        headers: {},
        score: 0,
      });
    });

    req.end();
  });
}

export class SecurityGuard extends BaseGuard {
  private options: SecurityAuditOptions;

  constructor(options: SecurityAuditOptions, context?: AuditContext) {
    super("security-guard", context);
    this.options = options;
  }

  async execute(): Promise<AuditResult> {
    const result = await performSecurityAuditInternal(this.options.targetUrl);

    const issues: AuditIssue[] = [];

    for (const report of result.reports) {
      let severity: AuditIssue["severity"] = "warning";
      if (report.includes("not HTTPS") || report.includes("failed") || report.includes("timed out")) {
        severity = "critical";
      } else if (report.includes("Missing security header")) {
        severity = "error";
      }

      issues.push(
        this.createIssue(
          `SECURITY_${report.split(":")[0]?.toUpperCase().replace(/\s+/g, "_") || "UNKNOWN"}`,
          severity,
          "Security Header Issue",
          report,
          undefined,
          "Configure the security header as recommended"
        )
      );
    }

    if (issues.length === 0) {
      return this.ok(`Security headers audit passed with score ${result.score}/100`);
    }

    return this.issues(issues, `Found ${issues.length} security issue(s) (score: ${result.score}/100)`);
  }
}

/**
 * @deprecated Use SecurityGuard class instead
 */
export async function performSecurityAudit(targetUrl: string): Promise<SecurityAuditResult> {
  return performSecurityAuditInternal(targetUrl);
}
