import { afterEach, describe, expect, it } from "vitest";
import { getOsvConfig } from "../../../../src/scan/config/osv.config.js";

const originalUrl = process.env.OSV_API_URL;
const originalTimeout = process.env.OSV_TIMEOUT;

function restore(name: "OSV_API_URL" | "OSV_TIMEOUT", value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

describe("getOsvConfig branches", () => {
  afterEach(() => {
    restore("OSV_API_URL", originalUrl);
    restore("OSV_TIMEOUT", originalTimeout);
  });

  it("uses defaults when no env is set", () => {
    delete process.env.OSV_API_URL;
    delete process.env.OSV_TIMEOUT;
    expect(getOsvConfig()).toEqual({
      protocol: "https:",
      hostname: "api.osv.dev",
      port: 443,
      path: "/v1/query",
      userAgent: "Muraqib-Audit-Tool/1.0",
      timeout: 10000,
    });
  });

  it("defaults to port 80 for http URLs and keeps query strings", () => {
    process.env.OSV_API_URL = "http://localhost/v1/query?x=1";
    const cfg = getOsvConfig();
    expect(cfg.port).toBe(80);
    expect(cfg.path).toBe("/v1/query?x=1");
  });

  it("uses an explicit port and numeric timeout", () => {
    process.env.OSV_API_URL = "http://localhost:8080/q";
    process.env.OSV_TIMEOUT = "2500";
    const cfg = getOsvConfig();
    expect(cfg.port).toBe("8080");
    expect(cfg.timeout).toBe(2500);
  });

  it("falls back to the default timeout for non-numeric values", () => {
    process.env.OSV_TIMEOUT = "abc";
    expect(getOsvConfig().timeout).toBe(10000);
  });

  it("throws naming OSV_API_URL when the URL is invalid", () => {
    process.env.OSV_API_URL = "not a url";
    expect(() => getOsvConfig()).toThrow("OSV_API_URL is not a valid URL: not a url");
  });
});
