import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SecurityGuard, isLocalHostname, performSecurityAudit } from "./security-guard.js";

const GOOD_HEADERS: Record<string, string> = {
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; font-src 'self'; img-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'",
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Strict-Transport-Security": "max-age=63072000",
  "Permissions-Policy": "geolocation=()",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Opener-Policy": "same-origin",
};

type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => void;

describe("security-guard (real local server)", () => {
  let server: http.Server;
  let handler: Handler;
  let base: string;
  let methods: string[];

  beforeEach(async () => {
    methods = [];
    handler = (_req, res) => {
      res.writeHead(200, GOOD_HEADERS);
      res.end();
    };
    server = http.createServer((req, res) => {
      methods.push(`${req.method ?? ""} ${req.url ?? ""}`);
      handler(req, res);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const codes = async (headers: Record<string, string>, extra?: Handler): Promise<string[]> => {
    handler = extra ?? ((_req, res) => {
      res.writeHead(200, headers);
      res.end();
    });
    const result = await new SecurityGuard({ targetUrl: base }).execute();
    return result.issues.map((issue) => issue.code);
  };

  it("passes with all good headers (mixed case) and reports isSecure with score 100", async () => {
    const result = await performSecurityAudit(base);
    expect(result.reports).toEqual([]);
    expect(result.findings).toEqual([]);
    expect(result.isSecure).toBe(true);
    expect(result.score).toBe(100);
    expect(result.finalUrl).toBe(`${base}/`);
    expect((await new SecurityGuard({ targetUrl: base }).execute()).status).toBe("ok");
  });

  it("reports missing required headers as error and recommended as warning with stable codes", async () => {
    handler = (_req, res) => {
      res.writeHead(200, {});
      res.end();
    };
    const audit = await new SecurityGuard({ targetUrl: base }).execute();
    const missing = audit.issues.filter((i) => i.code === "SECURITY_MISSING_HEADER");
    const recommended = audit.issues.filter((i) => i.code === "SECURITY_MISSING_RECOMMENDED_HEADER");
    expect(missing).toHaveLength(5);
    expect(missing.every((i) => i.severity === "error")).toBe(true);
    expect(recommended).toHaveLength(3);
    expect(recommended.every((i) => i.severity === "warning")).toBe(true);
    const raw = await performSecurityAudit(base);
    expect(raw.score).toBeGreaterThan(0);
    expect(raw.score).toBeLessThan(100);
  });

  it("flags weak HSTS", async () => {
    expect(await codes({ ...GOOD_HEADERS, "Strict-Transport-Security": "max-age=100" })).toEqual(["SECURITY_HSTS_WEAK"]);
  });

  it("flags unsafe CSP tokens", async () => {
    const csp = "default-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'";
    expect(await codes({ ...GOOD_HEADERS, "Content-Security-Policy": csp })).toEqual(["SECURITY_CSP_UNSAFE"]);
  });

  it("parses CSP directives instead of substrings", async () => {
    // 'img-src' only appears as a value, never as a directive name
    const csp = "default-src 'self'; connect-src https://img-src.example font-src";
    const found = await codes({ ...GOOD_HEADERS, "Content-Security-Policy": csp });
    expect(found).toEqual(["SECURITY_CSP_MISSING_DIRECTIVE"]);
  });

  it("detects script-src 'none' anywhere in the policy", async () => {
    const csp = "default-src 'self'; font-src 'self'; img-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; script-src 'none'";
    expect(await codes({ ...GOOD_HEADERS, "Content-Security-Policy": csp })).toEqual(["SECURITY_CSP_SCRIPT_NONE"]);
  });

  it("flags weak X-Frame-Options", async () => {
    expect(await codes({ ...GOOD_HEADERS, "X-Frame-Options": "ALLOW-FROM x" })).toEqual(["SECURITY_XFO_WEAK"]);
  });

  it("falls back to GET when HEAD answers 405", async () => {
    handler = (req, res) => {
      if (req.method === "HEAD") {
        res.writeHead(405);
        res.end();
        return;
      }
      res.writeHead(200, GOOD_HEADERS);
      res.end("body");
    };
    const result = await performSecurityAudit(base);
    expect(result.isSecure).toBe(true);
    expect(methods).toEqual(["HEAD /", "GET /"]);
  });

  it("falls back to GET when HEAD answers 501", async () => {
    handler = (req, res) => {
      res.writeHead(req.method === "HEAD" ? 501 : 200, req.method === "HEAD" ? {} : GOOD_HEADERS);
      res.end();
    };
    expect((await performSecurityAudit(base)).isSecure).toBe(true);
  });

  it("follows redirects and reads headers from the final response", async () => {
    handler = (req, res) => {
      if (req.url === "/start") {
        res.writeHead(302, { Location: "/middle" });
      } else if (req.url === "/middle") {
        res.writeHead(301, { Location: `${base}/final` });
      } else {
        res.writeHead(200, GOOD_HEADERS);
      }
      res.end();
    };
    const result = await performSecurityAudit(`${base}/start`);
    expect(result.isSecure).toBe(true);
    expect(result.finalUrl).toBe(`${base}/final`);
  });

  it("stops redirect loops with a single failure finding", async () => {
    handler = (_req, res) => {
      res.writeHead(302, { Location: "/loop" });
      res.end();
    };
    const result = await performSecurityAudit(`${base}/loop`);
    expect(result.findings.map((f) => f.code)).toEqual(["SECURITY_REQUEST_FAILED"]);
    expect(result.score).toBe(0);
  });

  it("caps long redirect chains", async () => {
    handler = (req, res) => {
      const n = Number((req.url ?? "/0").slice(1));
      res.writeHead(302, { Location: `/${n + 1}` });
      res.end();
    };
    const result = await performSecurityAudit(`${base}/0`);
    expect(result.findings.map((f) => f.code)).toEqual(["SECURITY_REQUEST_FAILED"]);
    expect(result.reports[0]).toContain("too many redirects");
  });

  it("reports exactly one critical finding on timeout and never mutates the result later", async () => {
    handler = () => {
      /* never answer */
    };
    const result = await performSecurityAudit(base, 100);
    expect(result.findings.map((f) => f.code)).toEqual(["SECURITY_REQUEST_TIMEOUT"]);
    expect(result.findings[0]?.severity).toBe("critical");
    expect(result.score).toBe(0);
    const snapshot = [...result.reports];
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(result.reports).toEqual(snapshot);
    const viaGuard = await new SecurityGuard({ targetUrl: base, timeoutMs: 100 }).execute();
    expect(viaGuard.issues).toHaveLength(1);
    expect(viaGuard.issues[0]?.severity).toBe("critical");
  });

  it("reports connection refused as a critical request failure", async () => {
    const dead = http.createServer();
    await new Promise<void>((resolve) => dead.listen(0, "127.0.0.1", resolve));
    const port = (dead.address() as AddressInfo).port;
    await new Promise<void>((resolve) => dead.close(() => resolve()));
    const result = await performSecurityAudit(`http://127.0.0.1:${port}`, 2000);
    expect(result.findings.map((f) => f.code)).toEqual(["SECURITY_REQUEST_FAILED"]);
    expect(result.isSecure).toBe(false);
    expect(result.headers).toEqual({});
  });

  it("turns an invalid URL into a finding instead of throwing", async () => {
    const result = await performSecurityAudit("not a url");
    expect(result.findings.map((f) => f.code)).toEqual(["SECURITY_REQUEST_FAILED"]);
    expect(result.reports[0]).toContain("invalid URL");
    const guard = await new SecurityGuard({ targetUrl: "::::" }).execute();
    expect(guard.issues[0]?.severity).toBe("critical");
  });

  it("rejects non-http(s) schemes", async () => {
    const result = await performSecurityAudit("ftp://example.com/file");
    expect(result.findings.map((f) => f.code)).toEqual(["SECURITY_REQUEST_FAILED"]);
    expect(result.reports[0]).toContain("unsupported protocol");
  });

  it("does not flag loopback hosts as non-HTTPS but flags remote plain HTTP", async () => {
    const result = await performSecurityAudit(base);
    expect(result.findings.some((f) => f.code === "SECURITY_NOT_HTTPS")).toBe(false);
    const remote = await performSecurityAudit("http://192.0.2.1/", 100);
    expect(remote.findings[0]?.code).toBe("SECURITY_NOT_HTTPS");
    expect(remote.findings[0]?.severity).toBe("critical");
  });
});

describe("isLocalHostname", () => {
  it.each(["localhost", "LOCALHOST", "app.localhost", "127.0.0.1", "127.9.8.7", "::1", "[::1]", "localhost."])(
    "treats %s as local",
    (host) => {
      expect(isLocalHostname(host)).toBe(true);
    }
  );

  it.each(["example.com", "128.0.0.1", "127.0.0.256", "localhost.example.com", "[::2]", "10.0.0.1"])(
    "treats %s as remote",
    (host) => {
      expect(isLocalHostname(host)).toBe(false);
    }
  );

  it("works on the hostname produced by URL", () => {
    expect(isLocalHostname(new URL("http://[::1]:8080").hostname)).toBe(true);
  });
});
