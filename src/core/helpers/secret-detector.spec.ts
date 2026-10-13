import { describe, it, expect } from "vitest";
import {
  tokenizeKey,
  isSensitiveKey,
  isPlaceholder,
  isNonSecretLiteral,
  tryParseUrl,
  urlCarriesSecret,
  shannonEntropy,
  looksLikeHighEntropySecret,
  matchesSecretPattern,
  isExposedEnvValue,
  isExposedPackageValue,
} from "./secret-detector.js";

const NONE: ReadonlySet<string> = new Set();

describe("tokenizeKey", () => {
  it("splits on separators and camelCase and upper-cases", () => {
    expect(tokenizeKey("apiKey")).toEqual(["API", "KEY"]);
    expect(tokenizeKey("DB_PASSWORD-v2")).toEqual(["DB", "PASSWORD", "V2"]);
    expect(tokenizeKey("")).toEqual([]);
  });
});

describe("isSensitiveKey", () => {
  it.each(["DB_PASSWORD", "authToken", "JWT_SECRET", "STRIPE_APIKEY", "PRIVATE_KEY", "api.key", "SIGNING_KEY"])(
    "treats %s as sensitive",
    (key) => expect(isSensitiveKey(key, NONE)).toBe(true)
  );

  it.each(["DATABASE_URL", "TOKEN_TTL", "PASSWORD_MIN_LENGTH", "AUTH_HEADER", "PORT", "KEY", "NODE_ENV"])(
    "treats %s as not sensitive",
    (key) => expect(isSensitiveKey(key, NONE)).toBe(false)
  );

  it("honours the explicit key set regardless of name", () => {
    expect(isSensitiveKey("muraqib_db_url", new Set(["MURAQIB_DB_URL"]))).toBe(true);
  });
});

describe("value classifiers", () => {
  it("recognises placeholders", () => {
    for (const v of ["<your-key>", "${TOKEN}", "{{ token }}", "your_api_key", "change-me", "xxxx", "****", "TODO", "null"]) {
      expect(isPlaceholder(v)).toBe(true);
    }
    expect(isPlaceholder("s3cr3t-value")).toBe(false);
  });

  it("recognises non-secret literals", () => {
    for (const v of ["true", "No", "OFF", "42", "3.14"]) expect(isNonSecretLiteral(v)).toBe(true);
    expect(isNonSecretLiteral("abc")).toBe(false);
  });

  it("parses URLs only when they have a scheme and are valid", () => {
    expect(tryParseUrl("postgres://u:p@h/db")?.hostname).toBe("h");
    expect(tryParseUrl("not a url")).toBeUndefined();
    expect(tryParseUrl("http://")).toBeUndefined();
  });

  it("detects secrets carried by URLs", () => {
    expect(urlCarriesSecret(new URL("postgres://user:hunter2@host/db"))).toBe(true);
    expect(urlCarriesSecret(new URL("postgres://user:%3Cpassword%3E@host/db"))).toBe(false);
    expect(urlCarriesSecret(new URL("https://h/x?api_key=abc123"))).toBe(true);
    expect(urlCarriesSecret(new URL("https://h/x?api_key=&page=2"))).toBe(false);
    expect(urlCarriesSecret(new URL("https://h/x?token=<token>"))).toBe(false);
    expect(urlCarriesSecret(new URL("https://example.com/path"))).toBe(false);
  });

  it("computes Shannon entropy", () => {
    expect(shannonEntropy("aaaa")).toBe(0);
    expect(shannonEntropy("abab")).toBeCloseTo(1, 5);
  });

  it("flags high-entropy mixed strings but not prose, paths or URLs", () => {
    expect(looksLikeHighEntropySecret("aB3$xY9!qW7#eR5&tU1@")).toBe(true);
    expect(looksLikeHighEntropySecret("short")).toBe(false);
    expect(looksLikeHighEntropySecret("this is a long sentence with spaces")).toBe(false);
    expect(looksLikeHighEntropySecret("https://example.com/aB3$xY9!qW7#eR5")).toBe(false);
    expect(looksLikeHighEntropySecret("/usr/local/lib/aB3xY9qW7eR5tU1")).toBe(false);
    expect(looksLikeHighEntropySecret("aaaaaaaaaaaaaaaaaaaaaaaa")).toBe(false);
  });
});

describe("matchesSecretPattern", () => {
  it.each([
    "-----BEGIN RSA PRIVATE KEY-----",
    "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc_DEF-123",
    "AKIAABCDEFGHIJKLMNOP",
    `ghp_${"a".repeat(36)}`,
    `sk-${"a".repeat(24)}`,
    "xoxb-1234567890-abcdef",
    `AIza${"a".repeat(35)}`,
    "mysql://root:toor@db/app",
  ])("matches %s", (v) => expect(matchesSecretPattern(v)).toBe(true));

  it("does not match ordinary values", () => {
    expect(matchesSecretPattern("hello world")).toBe(false);
    expect(matchesSecretPattern("https://example.com")).toBe(false);
  });
});

describe("isExposedEnvValue", () => {
  it("ignores empty values and placeholders", () => {
    expect(isExposedEnvValue("API_TOKEN", "  ", NONE)).toBe(false);
    expect(isExposedEnvValue("API_TOKEN", "your-token-here", NONE)).toBe(false);
  });

  it("flags explicit keys even with weak values", () => {
    expect(isExposedEnvValue("MURAQIB_DB_URL", "x", new Set(["MURAQIB_DB_URL"]))).toBe(true);
  });

  it("flags known patterns and sensitive keys with real values", () => {
    expect(isExposedEnvValue("ANYTHING", `ghp_${"b".repeat(36)}`, NONE)).toBe(true);
    expect(isExposedEnvValue("DB_PASSWORD", "hunter2", NONE)).toBe(true);
    expect(isExposedEnvValue("BLOB", "aB3$xY9!qW7#eR5&tU1@", NONE)).toBe(true);
  });

  it("does not flag URLs without credentials, literals or plain config", () => {
    expect(isExposedEnvValue("DB_PASSWORD_URL", "https://example.com", NONE)).toBe(false);
    expect(isExposedEnvValue("AUTH_URL", "https://example.com/auth", NONE)).toBe(false);
    expect(isExposedEnvValue("SECRET", "true", NONE)).toBe(false);
    expect(isExposedEnvValue("NODE_ENV", "production", NONE)).toBe(false);
    expect(isExposedEnvValue("PORT", "3000", NONE)).toBe(false);
  });
});

describe("isExposedPackageValue", () => {
  it("flags secrets and sensitive keys with real values", () => {
    expect(isExposedPackageValue("npmToken", "abcdef123")).toBe(true);
    expect(isExposedPackageValue("x", `ghp_${"c".repeat(36)}`)).toBe(true);
  });

  it("ignores empty, placeholder, URL, literal and non-sensitive values", () => {
    expect(isExposedPackageValue("npmToken", "")).toBe(false);
    expect(isExposedPackageValue("npmToken", "<token>")).toBe(false);
    expect(isExposedPackageValue("npmToken", "https://registry.npmjs.org")).toBe(false);
    expect(isExposedPackageValue("npmToken", "true")).toBe(false);
    expect(isExposedPackageValue("name", "muraqib")).toBe(false);
  });
});
