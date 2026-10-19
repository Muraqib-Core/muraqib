import { describe, it, expect, test } from "vitest";
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
  assessSecretRisk,
  detectSecretsInEnv,
  detectSecretsInText,
  findSecrets,
  maskSecret,
  type DetectedSecret,
} from "../../../src/core/secret-detector.js";

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

// ---------------------------------------------------------------------------
// Text scanning (formerly the separate AI secret detector)
// ---------------------------------------------------------------------------

const secret = (type: DetectedSecret["type"], confidence: number): DetectedSecret => ({
  type,
  pattern: "xx***yy",
  confidence,
  description: "test",
});

describe("detectSecretsInText", () => {
  test("detects a Stripe live secret key and masks it", () => {
    const key = `sk_live_${"a".repeat(24)}`;
    const found = detectSecretsInText(`const k = "${key}";`);
    const hit = found.find((s) => s.description === "Stripe secret key");
    expect(hit).toBeDefined();
    expect(hit?.type).toBe("api_key");
    expect(hit?.pattern).not.toContain(key);
    expect(hit?.pattern).toContain("*");
  });

  test("detects GitHub tokens, AWS key ids and private keys", () => {
    const text = [
      `token=ghp_${"b".repeat(36)}`,
      "id=AKIAABCDEFGHIJKLMNOP",
      "-----BEGIN RSA PRIVATE KEY-----",
      "-----BEGIN CERTIFICATE-----",
    ].join("\n");
    const descriptions = detectSecretsInText(text).map((s) => s.description);
    expect(descriptions).toContain("GitHub personal access token");
    expect(descriptions).toContain("AWS access key ID");
    expect(descriptions).toContain("Private key PEM block");
    expect(descriptions).toContain("SSL/TLS certificate");
  });

  test("detects password, database, oauth and webhook assignments", () => {
    const text = [
      `password = "hunter2hunter2"`,
      `DATABASE_URL = "postgres://u:p@h/db"`,
      `oauth_token: "abc123"`,
      `webhook_secret = "whsec_123"`,
      `Authorization: Bearer abc.def-ghi `,
    ].join("\n");
    const types = detectSecretsInText(text).map((s) => s.type);
    expect(types).toContain("password");
    expect(types).toContain("db_credential");
    expect(types).toContain("oauth_token");
    expect(types).toContain("webhook_secret");
    expect(types).toContain("bearer_token");
  });

  test("computes the line number from the match position", () => {
    const text = `line one\nline two\npassword = "secret-value"`;
    const hit = detectSecretsInText(text).find((s) => s.type === "password");
    expect(hit?.line).toBe(3);
  });

  test("uses the supplied file info instead of computing the line", () => {
    const hit = detectSecretsInText(`password = "secret-value"`, {
      file: ".env",
      line: 9,
    }).find((s) => s.type === "password");
    expect(hit?.file).toBe(".env");
    expect(hit?.line).toBe(9);
  });

  test("reports an identical match only once", () => {
    const text = `password = "dup-value"\npassword = "dup-value"`;
    const hits = detectSecretsInText(text).filter((s) => s.type === "password");
    expect(hits).toHaveLength(1);
  });

  test("returns nothing for clean text", () => {
    expect(detectSecretsInText("const answer = 'hello';")).toEqual([]);
  });

  test("masks very short matches completely", () => {
    // PII pattern can match short numeric strings of 4 chars or fewer.
    const found = detectSecretsInText("id 1234 end");
    const pii = found.find((s) => s.type === "pii");
    expect(pii?.pattern).toBe("****");
  });
});

describe("detectSecretsInEnv", () => {
  test("flags variables with sensitive-looking names", () => {
    const found = detectSecretsInEnv({ API_TOKEN: "abcdefghij", PLAIN: "value" });
    const flagged = found.filter((s) => s.description.includes("API_TOKEN"));
    expect(flagged).toHaveLength(1);
    expect(flagged[0]?.confidence).toBe(0.6);
  });

  test("skips empty and undefined values", () => {
    expect(detectSecretsInEnv({ SECRET: "", TOKEN: undefined })).toEqual([]);
  });

  test("scans values for known patterns and tags the variable name", () => {
    const found = detectSecretsInEnv({ CONFIG: `ghp_${"c".repeat(36)}` });
    const hit = found.find((s) => s.description === "GitHub personal access token");
    expect(hit?.file).toBe("CONFIG");
  });
});

describe("assessSecretRisk", () => {
  test("is safe when nothing was found", () => {
    expect(assessSecretRisk([])).toMatchObject({ risk: "safe", totalFound: 0 });
  });

  test("is critical for api keys, passwords and private keys", () => {
    const result = assessSecretRisk([secret("password", 0.7)]);
    expect(result.risk).toBe("critical");
    expect(result.criticalCount).toBe(1);
  });

  test("is high when only high-confidence non-critical secrets exist", () => {
    const result = assessSecretRisk([secret("certificate", 0.98)]);
    expect(result.risk).toBe("high");
    expect(result.highConfidence).toHaveLength(1);
  });

  test("is medium for more than three low-confidence findings", () => {
    const many = Array.from({ length: 4 }, () => secret("pii", 0.5));
    expect(assessSecretRisk(many).risk).toBe("medium");
  });

  test("is low for a few low-confidence findings", () => {
    expect(assessSecretRisk([secret("pii", 0.5)]).risk).toBe("low");
  });
});

// ---------------------------------------------------------------------------
// Unified detector: shared token table and blocking decisions
// ---------------------------------------------------------------------------

const fake = (prefix: string, length: number): string => `${prefix}${"aB3".repeat(length).slice(0, length)}`;

describe("findSecrets blocking decisions", () => {
  test.each([
    ["Stripe secret key", fake("sk_live_", 24)],
    ["GitHub personal access token", fake("ghp_", 36)],
    ["GitHub fine-grained token", fake("github_pat_", 40)],
    ["AWS access key ID", "AKIAABCDEFGHIJKLMNOP"],
    ["Slack token", "xoxb-1234567890-abcdefghij"],
    ["API secret key (sk- prefix)", fake("sk-", 32)],
    ["Private key PEM block", "-----BEGIN OPENSSH PRIVATE KEY-----"],
  ])("%s is blocking", (description, text) => {
    const hit = findSecrets(`const v = "${text}";`).find((m) => m.description === description);
    expect(hit?.blocking).toBe(true);
  });

  test.each([
    ["Stripe public key", fake("pk_live_", 24)],
    ["Google API key", fake("AIza", 35)],
    ["JSON Web Token", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl"],
    ["SSL/TLS certificate", "-----BEGIN CERTIFICATE-----"],
  ])("%s is reported but never blocking", (description, text) => {
    const hit = findSecrets(`const v = "${text}";`).find((m) => m.description === description);
    expect(hit).toBeDefined();
    expect(hit?.blocking).toBe(false);
  });

  test("a PKCS#8 private key header without an algorithm is detected", () => {
    expect(detectSecretsInText("-----BEGIN PRIVATE KEY-----").map((s) => s.description)).toContain("Private key PEM block");
    expect(detectSecretsInText("-----BEGIN ENCRYPTED PRIVATE KEY-----").map((s) => s.type)).toContain("private_key");
  });

  test("sk- identifiers without digits (kebab-case words) are not secrets", () => {
    expect(findSecrets("class sk-widget-container-wrapper-large")).toEqual([]);
  });

  test("password assignments are advisory, never blocking", () => {
    const hit = findSecrets(`password = "hunter2hunter2"`).find((m) => m.type === "password");
    expect(hit).toMatchObject({ blocking: false, confidence: 0.7 });
  });

  test("oauth and webhook assignments block only for long, non-placeholder values", () => {
    const real = "r4nd0mValue_9f3kQz7LpX2";
    expect(findSecrets(`webhook_secret = "${real}"`)[0]?.blocking).toBe(true);
    expect(findSecrets(`oauth_token: "${real}"`)[0]?.blocking).toBe(true);
    expect(findSecrets(`webhook_secret = "whsec_123"`)[0]?.blocking).toBe(false);
    expect(findSecrets(`webhook_secret = "your-webhook-secret-here"`)[0]?.blocking).toBe(false);
  });

  test("database credentials block only when they carry a real-looking password", () => {
    const blocking = (text: string): boolean | undefined => findSecrets(text).find((m) => m.type === "db_credential")?.blocking;
    expect(blocking(`DATABASE_URL = "postgres://app:Zq8rT2vLmN4x@db.internal/app"`)).toBe(true);
    expect(blocking(`DB_PASSWORD = "Zq8rT2vLmN4xPw"`)).toBe(true);
    expect(blocking(`DATABASE_URL = "postgres://user:password@localhost/db"`)).toBe(false);
    expect(blocking(`DB_PASSWORD = "postgres"`)).toBe(false);
  });

  test("a URL password with malformed percent-encoding is judged as written instead of throwing", () => {
    const text = `DATABASE_URL = "postgres://u:%ZZq9@h/db"`;
    expect(() => findSecrets(text)).not.toThrow();
    expect(findSecrets(text).find((m) => m.type === "db_credential")?.blocking).toBe(true);
    expect(urlCarriesSecret(new URL("postgres://u:%ZZq9@h/db"))).toBe(true);
  });

  test("includeHeuristics: false drops the numeric PII pattern", () => {
    expect(findSecrets("order 12345 678").some((m) => m.type === "pii")).toBe(true);
    expect(findSecrets("order 12345 678", { includeHeuristics: false })).toEqual([]);
  });

  test("ignorePlaceholders drops credential assignments with placeholder values", () => {
    const text = `password = "<your-password>"`;
    expect(findSecrets(text)).toHaveLength(1);
    expect(findSecrets(text, { ignorePlaceholders: true })).toEqual([]);
  });

  test("never exposes the full secret", () => {
    const key = fake("sk_live_", 24);
    const [hit] = findSecrets(key);
    expect(hit?.pattern).not.toContain(key);
    expect(hit?.pattern.length).toBe(key.length);
  });
});

describe("maskSecret", () => {
  test.each([
    ["", ""],
    ["abcd", "****"],
    ["abcdefgh", "********"],
    ["abcdefghi", "ab****ghi"],
    ["sk_live_abcdefghijkl", "sk***************jkl"],
  ])("masks %j as %j", (input, expected) => {
    expect(maskSecret(input)).toBe(expected);
  });
});

describe("one token table serves text scanning and whole-value checks", () => {
  test.each([
    fake("sk_live_", 24),
    fake("ghp_", 36),
    fake("github_pat_", 40),
    "ASIAABCDEFGHIJKLMNOP",
    fake("sk-", 32),
    "-----BEGIN PRIVATE KEY-----",
  ])("%s is a secret both in text and as an env value", (token) => {
    expect(findSecrets(token).some((m) => m.blocking)).toBe(true);
    expect(matchesSecretPattern(token)).toBe(true);
    expect(isExposedEnvValue("ANYTHING", token, NONE)).toBe(true);
  });

  test("public-by-design formats are not treated as exposed env values", () => {
    expect(matchesSecretPattern(fake("pk_live_", 24))).toBe(false);
    expect(matchesSecretPattern("-----BEGIN CERTIFICATE-----")).toBe(false);
  });
});
