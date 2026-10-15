import https from "https";
import http from "http";
import { BaseGuard } from "./base-guard.js";
import type { AuditResult, AuditIssue, AuditContext } from "./types.js";

/** A structured security finding. `code` is stable and never derived from message text. */
export interface SecurityFinding { // muraqib-ignore-dead: structured finding shape of SecurityAuditResult
  code: string;
  severity: "critical" | "error" | "warning" | "info";
  message: string;
  file?: string;
  line?: number;
}

/**
 * Result of a security audit on an HTTP endpoint
 * @interface SecurityAuditResult
 */
export interface SecurityAuditResult { // muraqib-ignore-dead: auto-suppressed by script for SecurityAuditResult
  isSecure: boolean;
  reports: string[];
  headers: Record<string, string | string[] | undefined>;
  score: number; // 0-100
  /** Structured findings, one per entry in `reports` (same order). */
  findings: SecurityFinding[];
  /** URL the headers were read from, after following redirects. */
  finalUrl: string;
}

/** Options accepted by {@link SecurityGuard}. */
export interface SecurityAuditOptions { // muraqib-ignore-dead: public options shape of SecurityGuard
  targetUrl: string;
  /** Per-request timeout in milliseconds (default 10000). */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10000;
const MAX_REDIRECTS = 5;
const MIN_HSTS_MAX_AGE = 31536000;

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

const RECOMMENDED_CSP_DIRECTIVES = ["font-src", "img-src", "style-src", "connect-src", "frame-ancestors"];

/** Checks counted by the score: every header, HSTS/CSP/XFO quality and the transport. */
const TOTAL_CHECKS = REQUIRED_HEADERS.length + RECOMMENDED_HEADERS.length + 3 + 1;

/**
 * Whether a hostname (as produced by `new URL().hostname`, brackets allowed) is a loopback host:
 * `localhost`, `*.localhost`, `::1` / `[::1]` and the whole `127.0.0.0/8` block.
 *
 * @param hostname - Hostname to classify.
 * @returns True when plain HTTP to this host is acceptable (local development).
 */
export function isLocalHostname(hostname: string): boolean {
  let host = hostname.trim().toLowerCase();
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  if (host.endsWith(".")) host = host.slice(0, -1);
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host === "::1" || host === "0:0:0:0:0:0:0:1") return true;
  const octets = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (octets === null) return false;
  return octets.slice(1).every((part) => Number(part) <= 255);
}

type ProbeOutcome =
  | { kind: "response"; statusCode: number; headers: http.IncomingHttpHeaders }
  | { kind: "error"; message: string }
  | { kind: "timeout" };

/** Performs ONE request and settles exactly once, whatever events fire afterwards. */
function requestOnce(target: string, method: "HEAD" | "GET", timeoutMs: number): Promise<ProbeOutcome> {
  return new Promise<ProbeOutcome>((resolve) => {
    let settled = false;
    const settle = (outcome: ProbeOutcome): void => {
      if (settled) return;
      settled = true;
      resolve(outcome);
    };
    let req: http.ClientRequest | undefined;
    try {
      const client = target.startsWith("https:") ? https : http;
      req = client.request(target, { method, timeout: timeoutMs }, (res) => {
        settle({ kind: "response", statusCode: res.statusCode ?? 0, headers: res.headers });
        // Only headers matter: never download the body.
        if (method === "GET" && typeof res.destroy === "function") res.destroy();
        else if (typeof res.resume === "function") res.resume();
      });
      req.on("error", (err: Error) => {
        settle({ kind: "error", message: err.message });
      });
      req.on("timeout", () => {
        settle({ kind: "timeout" });
        req?.destroy(new Error("Security audit request timed out"));
      });
      req.end();
    } catch (error) {
      settle({ kind: "error", message: error instanceof Error ? error.message : String(error) });
    }
  });
}

/** Parses a CSP header into lower-cased directive name -> value tokens. */
function parseCsp(csp: string): Map<string, string[]> {
  const directives = new Map<string, string[]>();
  for (const part of csp.split(";")) {
    const tokens = part.trim().split(/\s+/).filter((token) => token.length > 0);
    const name = tokens[0]?.toLowerCase();
    if (name !== undefined && !directives.has(name)) directives.set(name, tokens.slice(1));
  }
  return directives;
}

/** Findings for the response headers (everything except transport/request problems). */
function analyzeHeaders(headers: http.IncomingHttpHeaders): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  const lower = new Map<string, string>();
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    lower.set(key.toLowerCase(), Array.isArray(value) ? value.join(", ") : String(value));
  }

  for (const header of REQUIRED_HEADERS) {
    if (!lower.has(header)) {
      findings.push({ code: "SECURITY_MISSING_HEADER", severity: "error", message: `Missing security header: ${header}` });
    }
  }
  for (const header of RECOMMENDED_HEADERS) {
    if (!lower.has(header)) {
      findings.push({ code: "SECURITY_MISSING_RECOMMENDED_HEADER", severity: "warning", message: `Missing recommended header: ${header}` });
    }
  }

  const hsts = lower.get("strict-transport-security");
  if (hsts !== undefined) {
    const maxAgeMatch = /max-age\s*=\s*"?(\d+)/i.exec(hsts);
    if (maxAgeMatch?.[1] !== undefined) {
      const maxAge = parseInt(maxAgeMatch[1], 10);
      if (maxAge < MIN_HSTS_MAX_AGE) {
        findings.push({ code: "SECURITY_HSTS_WEAK", severity: "warning", message: `HSTS max-age too low: ${maxAge}s (recommended: ${MIN_HSTS_MAX_AGE}s)` });
      }
    }
  }

  const csp = lower.get("content-security-policy");
  if (csp !== undefined) {
    const directives = parseCsp(csp);
    const unsafe = [...new Set((csp.match(/'unsafe-[^']+'/gi) ?? []).map((token) => token.toLowerCase()))];
    if (unsafe.length > 0) {
      findings.push({ code: "SECURITY_CSP_UNSAFE", severity: "warning", message: `CSP contains unsafe directives: ${unsafe.join(", ")}` });
    }
    if (!directives.has("default-src") && !directives.has("script-src")) {
      findings.push({ code: "SECURITY_CSP_MISSING_DIRECTIVE", severity: "warning", message: "CSP missing default-src or script-src directive" });
    }
    const missing = RECOMMENDED_CSP_DIRECTIVES.filter((directive) => !directives.has(directive));
    if (missing.length > 0) {
      findings.push({ code: "SECURITY_CSP_MISSING_DIRECTIVE", severity: "warning", message: `CSP missing recommended directives: ${missing.join(", ")}` });
    }
    const scriptSrc = directives.get("script-src");
    if (scriptSrc?.some((token) => token.toLowerCase() === "'none'") === true) {
      findings.push({ code: "SECURITY_CSP_SCRIPT_NONE", severity: "warning", message: "CSP script-src is set to 'none', blocking all scripts" });
    }
  }

  const xfoRaw = lower.get("x-frame-options");
  if (xfoRaw !== undefined) {
    const xfo = xfoRaw.trim().toLowerCase();
    if (xfo !== "deny" && xfo !== "sameorigin") {
      findings.push({ code: "SECURITY_XFO_WEAK", severity: "warning", message: `X-Frame-Options has weak value: ${xfo}` });
    }
  }
  return findings;
}

/** Maps a finding to the score check it belongs to (CSP findings count as one check). */
function checkKey(finding: SecurityFinding): string {
  if (finding.code.startsWith("SECURITY_CSP_")) return "csp-quality";
  if (finding.code === "SECURITY_HSTS_WEAK") return "hsts-quality";
  if (finding.code === "SECURITY_XFO_WEAK") return "xfo-quality";
  return finding.code === "SECURITY_NOT_HTTPS" ? "transport" : finding.message;
}

function buildResult(
  findings: SecurityFinding[],
  headers: SecurityAuditResult["headers"],
  finalUrl: string,
  requestFailed: boolean
): SecurityAuditResult {
  const failed = new Set(findings.map(checkKey)).size;
  const score = requestFailed ? 0 : Math.min(100, Math.max(0, Math.round(((TOTAL_CHECKS - failed) / TOTAL_CHECKS) * 100)));
  return {
    isSecure: findings.length === 0,
    reports: findings.map((finding) => finding.message),
    headers,
    score,
    findings,
    finalUrl,
  };
}

async function performSecurityAuditInternal(targetUrl: string, timeoutOption?: number): Promise<SecurityAuditResult> {
  const timeoutMs = timeoutOption !== undefined && Number.isFinite(timeoutOption) && timeoutOption > 0 ? timeoutOption : DEFAULT_TIMEOUT_MS;
  const findings: SecurityFinding[] = [];
  const fail = (message: string, code = "SECURITY_REQUEST_FAILED", finalUrl = targetUrl): SecurityAuditResult => {
    findings.push({ code, severity: "critical", message });
    return buildResult(findings, {}, finalUrl, true);
  };

  let current: URL;
  try {
    current = new URL(targetUrl);
  } catch {
    return fail(`Security audit request failed: invalid URL "${targetUrl}"`);
  }
  if (current.protocol !== "http:" && current.protocol !== "https:") {
    return fail(`Security audit request failed: unsupported protocol ${current.protocol} (only http and https)`);
  }

  // For remote hosts, warn if connection is not HTTPS. For localhost (dev) allow HTTP.
  if (!isLocalHostname(current.hostname) && current.protocol !== "https:") {
    findings.push({ code: "SECURITY_NOT_HTTPS", severity: "critical", message: "Connection is not HTTPS — data transmitted in plaintext" });
  }

  const visited = new Set<string>();
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    visited.add(current.href);
    let outcome = await requestOnce(current.href, "HEAD", timeoutMs);
    if (outcome.kind === "response" && (outcome.statusCode === 405 || outcome.statusCode === 501)) {
      outcome = await requestOnce(current.href, "GET", timeoutMs);
    }
    if (outcome.kind === "timeout") {
      return fail("Security audit request timed out", "SECURITY_REQUEST_TIMEOUT", current.href);
    }
    if (outcome.kind === "error") {
      return fail(`Security audit request failed: ${outcome.message}`, "SECURITY_REQUEST_FAILED", current.href);
    }

    const location = outcome.headers.location;
    const isRedirect = outcome.statusCode >= 300 && outcome.statusCode < 400 && typeof location === "string" && location.length > 0;
    if (isRedirect) {
      let next: URL | undefined;
      try {
        next = new URL(location, current);
      } catch {
        return fail(`Security audit request failed: invalid redirect location "${location}"`, "SECURITY_REQUEST_FAILED", current.href);
      }
      const downgrade = current.protocol === "https:" && next.protocol === "http:";
      if ((next.protocol === "http:" || next.protocol === "https:") && !downgrade) {
        if (visited.has(next.href) || hop === MAX_REDIRECTS) {
          return fail("Security audit request failed: too many redirects", "SECURITY_REQUEST_FAILED", current.href);
        }
        current = next;
        continue;
      }
      // Redirect to a downgraded/foreign scheme: audit the redirect response itself.
    }

    findings.push(...analyzeHeaders(outcome.headers));
    return buildResult(findings, outcome.headers, current.href, false);
  }
  return fail("Security audit request failed: too many redirects", "SECURITY_REQUEST_FAILED", current.href);
}

/**
 * Probes a target URL for missing HTTP security headers and common web vulnerabilities.
 * Severity levels used: error, warning, critical.
 */
export class SecurityGuard extends BaseGuard {
  private options: SecurityAuditOptions;

  constructor(options: SecurityAuditOptions, context?: AuditContext) {
    super("security-guard", context);
    this.options = options;
  }

  /**
   * Execute.
   *
   * @returns Execute result
   */
  async execute(): Promise<AuditResult> {
    const result = await performSecurityAuditInternal(this.options.targetUrl, this.options.timeoutMs);

    const issues: AuditIssue[] = result.findings.map((finding) =>
      this.createIssue(
        finding.code,
        finding.severity,
        "Security Header Issue",
        finding.message,
        finding.file === undefined ? undefined : { file: finding.file, ...(finding.line === undefined ? {} : { line: finding.line }) },
        "Configure the security header as recommended"
      )
    );

    if (issues.length === 0) {
      return this.ok(`Security headers audit passed with score ${result.score}/100`);
    }

    return this.issues(issues, `Found ${issues.length} security issue(s) (score: ${result.score}/100)`);
  }
}

/**
 * @deprecated Use SecurityGuard class instead
 */
export async function performSecurityAudit(targetUrl: string, timeoutMs?: number): Promise<SecurityAuditResult> {
  return performSecurityAuditInternal(targetUrl, timeoutMs);
}
