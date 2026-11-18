import { describe, expect, test } from "vitest";
import { containsSecret, redactText } from "../../../../src/agent-v2/explain/redact.js";

const j = (...parts: string[]): string => parts.join("");

const FORMATS: ReadonlyArray<readonly [string, string]> = [
  ["stripe live", ["sk", "live", "A1b2C3d4E5f6G7h8I9j0K1l2"].join("_")],
  ["github pat", j("gh", "p_", "A1b2C3d4E5f6G7h8I9j0K1l2M3")],
  ["github fine-grained", j("github", "_pat_", "A1b2C3d4E5f6G7h8I9j0K1l2")],
  ["aws", j("AK", "IA", "ABCDEFGHIJKLMNOP")],
  ["slack", j("xo", "xb-", "1234567890-abcdefgh")],
  ["openai style", j("sk", "-", "A1b2C3d4E5f6G7h8I9j0")],
  ["google api", j("AI", "za", "SyA1b2C3d4E5f6G7h8I9j0K1l2M3n4")],
  ["jwt", j("ey", "J", "hbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc123def456")],
  ["url credentials", j("postgres", "://", "admin", ":", "hunter2pass", "@", "db.example.com/app")],
  ["private key", j("-----BEGIN ", "RSA PRIVATE KEY-----\nMIIEabc123\n-----END ", "RSA PRIVATE KEY-----")],
];

describe("redactText", () => {
  test.each(FORMATS)("redacts %s credential", (_name, secret) => {
    const out = redactText(`before ${secret} after`);
    expect(out).toContain("[REDACTED]");
    expect(out).not.toContain(secret);
    expect(out).toContain("before");
    expect(out).toContain("after");
  });

  test("assignment keeps the name and drops the value", () => {
    const value = j("hunter2", "Value99");
    const out = redactText(`DB_PASSWORD = "${value}"`);
    expect(out).toContain("DB_PASSWORD");
    expect(out).toContain("[REDACTED]");
    expect(out).not.toContain(value);
    expect(redactText(`api_token: ${value}`)).toBe("api_token: [REDACTED]");
  });

  test("extraSecrets are removed everywhere", () => {
    const key = j("my", "-plain-", "apikey-value");
    const out = redactText(`a ${key} b ${key}`, [key]);
    expect(out).not.toContain(key);
    expect(out.match(/\[REDACTED\]/g)).toHaveLength(2);
  });

  test("very short extraSecrets are ignored", () => {
    expect(redactText("abc abc", ["abc"])).toBe("abc abc");
  });

  test("plain text is untouched", () => {
    const text = "A promise is never awaited in src/server.ts:12";
    expect(redactText(text)).toBe(text);
  });
});

describe("containsSecret", () => {
  test("true for a recognised credential", () => {
    expect(containsSecret(`token ${["sk", "live", "A1b2C3d4E5f6G7h8I9j0K1l2"].join("_")}`)).toBe(true);
  });
  test("false for clean text", () => {
    expect(containsSecret("Floating promise in src/a.ts line 3")).toBe(false);
    expect(containsSecret("")).toBe(false);
  });
});

describe("redactText bearer tokens", () => {
  test("removes a bearer token even when a quote follows it", () => {
    const token = ["abc123", "DEF456", "ghi789"].join("");
    const out = redactText(`{"header":"Bearer ${token}"}`);
    expect(out).not.toContain(token);
    expect(containsSecret(out)).toBe(false);
  });
});
