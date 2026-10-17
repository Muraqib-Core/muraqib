/**
 * Unified secret detection.
 *
 * One module answers every "is this a secret?" question in Muraqib:
 * - free-text scanning for known token formats and credential assignments ({@link findSecrets},
 *   {@link detectSecretsInText}), used by {@link SecretGuard} and the git pre-commit hook;
 * - whole-value classification of `.env` and `package.json` values ({@link isExposedEnvValue},
 *   {@link isExposedPackageValue}), used by `ConfigGuard`.
 *
 * Both views share one table of token formats, so a format added once is recognised in a source
 * file, in an `.env` value and in a staged diff. Everything here is pure: no I/O, no globals.
 */

/** Kinds of secret that can be detected. */
export type SecretType =
  | "api_key"
  | "bearer_token"
  | "password"
  | "private_key"
  | "db_credential"
  | "oauth_token"
  | "pii"
  | "certificate"
  | "webhook_secret";

/** Detected secret with location and severity. */
export interface DetectedSecret {
  /** Type of secret (api_key, password, private_key, etc.) */
  type: SecretType;
  /** Matched text, masked so the secret itself is never exposed */
  pattern: string;
  /** File location if found */
  file?: string | undefined;
  /** Line number if found */
  line?: number | undefined;
  /** Confidence level (0-1) */
  confidence: number;
  /** Description of the secret */
  description: string;
}

/** A {@link DetectedSecret} that also says whether it is strong enough to block a commit. */
export interface SecretMatch extends DetectedSecret {
  /** True for credentials that are almost certainly real; false for advisory or heuristic hits. */
  blocking: boolean;
}

/** Options for {@link findSecrets}. */
export interface FindSecretsOptions {
  file?: string | undefined;
  /** Reported for every match; computed from the match position when omitted. */
  line?: number | undefined;
  /** Include weak heuristics such as the numeric "PII" pattern (default true). */
  includeHeuristics?: boolean | undefined;
  /** Drop credential assignments whose value is an obvious placeholder (default false). */
  ignorePlaceholders?: boolean | undefined;
}

// ---------------------------------------------------------------------------
// Key and value heuristics (whole-value classification)
// ---------------------------------------------------------------------------

const SENSITIVE_KEY_WORDS = new Set([
  "PASSWORD", "PASSWD", "SECRET", "SECRETS", "TOKEN", "TOKENS",
  "CREDENTIAL", "CREDENTIALS", "AUTH", "JWT", "APIKEY",
]);

const SENSITIVE_KEY_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["API", "KEY"], ["PRIVATE", "KEY"], ["ACCESS", "KEY"],
  ["ENCRYPTION", "KEY"], ["SIGNING", "KEY"],
];

const NON_SECRET_KEY_SUFFIXES = new Set([
  "URL", "URI", "HOST", "HOSTNAME", "PORT", "PATH", "FILE", "DIR",
  "LENGTH", "MIN", "MAX", "TTL", "TIMEOUT", "EXPIRES", "EXPIRY",
  "IN", "SECONDS", "MINUTES", "HOURS", "DAYS", "MS", "ENABLED",
  "DISABLED", "REQUIRED", "HEADER", "NAME", "FIELD", "ENDPOINT",
  "ROUTE", "TYPE", "ALGORITHM", "ISSUER", "AUDIENCE",
]);

const PLACEHOLDER_PATTERNS: readonly RegExp[] = [
  /^<.*>$/, /^\$\{.*\}$/, /^\{\{.*\}\}$/,
  /^(?:your|my)[-_ ].+/i, /^(?:change|replace)[-_ ]?me$/i,
  /^x{3,}$/i, /^\*{3,}$/, /^(?:example|placeholder|todo|tbd|null|undefined|none|redacted)$/i,
];

/** Passwords that appear in documentation and local setups rather than in production. */
const SAMPLE_CREDENTIALS = new Set([
  "password", "pass", "passwd", "secret", "changeme", "change-me", "123456", "12345678",
  "postgres", "root", "admin", "test", "example", "user", "username", "mysecret", "hunter2",
]);

// ---------------------------------------------------------------------------
// Token formats: one table feeds both free-text scanning and whole-value checks
// ---------------------------------------------------------------------------

/** How a token format is recognised when it is the entire value of an env/package entry. */
type ValueForm = "anchored" | "contains" | "none";

interface TokenFormat {
  /** Regex source for the token as it appears in text (no anchors, no flags). */
  source: string;
  type: SecretType;
  confidence: number;
  /** Blocking formats are credentials; non-blocking ones are public by design or ambiguous. */
  blocking: boolean;
  description: string;
  /** Whole-value form for env/package checks; `none` for formats that are not secrets there. */
  valueForm: ValueForm;
  /** Extra check applied to text matches only. */
  verify?: (match: string) => boolean;
}

/** Real keys mix letters and digits; this rejects kebab-case identifiers that merely start with `sk-`. */
const hasLetterAndDigit = (match: string): boolean => /[A-Za-z]/.test(match) && /\d/.test(match);

const TOKEN_FORMATS: readonly TokenFormat[] = [
  { source: "\\bsk_live_[A-Za-z0-9]{20,40}\\b", type: "api_key", confidence: 0.95, blocking: true, valueForm: "anchored", description: "Stripe secret key" },
  { source: "\\bpk_live_[A-Za-z0-9]{20,40}\\b", type: "api_key", confidence: 0.9, blocking: false, valueForm: "none", description: "Stripe public key" },
  { source: "\\bgh[pousr]_[A-Za-z0-9]{30,}\\b", type: "api_key", confidence: 0.98, blocking: true, valueForm: "anchored", description: "GitHub personal access token" },
  { source: "\\bgithub_pat_[A-Za-z0-9_]{22,}\\b", type: "api_key", confidence: 0.98, blocking: true, valueForm: "anchored", description: "GitHub fine-grained token" },
  { source: "\\b(?:AKIA|ASIA)[0-9A-Z]{16}\\b", type: "api_key", confidence: 0.95, blocking: true, valueForm: "anchored", description: "AWS access key ID" },
  { source: "-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----", type: "private_key", confidence: 0.99, blocking: true, valueForm: "contains", description: "Private key PEM block" },
  { source: "-----BEGIN CERTIFICATE-----", type: "certificate", confidence: 0.98, blocking: false, valueForm: "none", description: "SSL/TLS certificate" },
  { source: "\\bxox[baprs]-[A-Za-z0-9-]{10,}", type: "oauth_token", confidence: 0.95, blocking: true, valueForm: "anchored", description: "Slack token" },
  { source: "\\bsk-[A-Za-z0-9_-]{20,}", type: "api_key", confidence: 0.9, blocking: true, valueForm: "anchored", description: "API secret key (sk- prefix)", verify: hasLetterAndDigit },
  { source: "\\bAIza[0-9A-Za-z_-]{35}", type: "api_key", confidence: 0.85, blocking: false, valueForm: "anchored", description: "Google API key" },
  { source: "\\beyJ[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+", type: "oauth_token", confidence: 0.8, blocking: false, valueForm: "anchored", description: "JSON Web Token" },
];

/** Whole-value matchers for env/package entries, derived from {@link TOKEN_FORMATS}. */
const SECRET_VALUE_PATTERNS: readonly RegExp[] = TOKEN_FORMATS.flatMap((format) => {
  if (format.valueForm === "none") return [];
  return [new RegExp(format.valueForm === "anchored" ? `^(?:${format.source})$` : format.source)];
});

// ---------------------------------------------------------------------------
// Credential assignments and heuristics (text only)
// ---------------------------------------------------------------------------

interface AssignmentRule {
  regex: RegExp;
  type: SecretType;
  confidence: number;
  description: string;
  /** Capture group holding the assigned value, when the rule has one. */
  valueGroup?: number;
  /** Weak signal that is skipped when `includeHeuristics` is false. */
  heuristic?: boolean;
  /** Decides whether a match is strong enough to block; defaults to advisory. */
  blocking?: (value: string, match: RegExpMatchArray) => boolean;
}

/** Percent-decodes a URL component; malformed escapes (`%ZZ`) leave the text as written instead of throwing. */
function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/** The credential part of a value: the password of a URL, otherwise the value itself. */
function credentialOf(value: string): string {
  const url = tryParseUrl(value);
  return url === undefined ? value : safeDecode(url.password);
}

const isSampleCredential = (value: string): boolean => {
  const credential = credentialOf(value).toLowerCase();
  return SAMPLE_CREDENTIALS.has(credential) || /^(.)\1+$/.test(credential);
};

/** A quoted assignment is blocking when its value is long, not a placeholder and not a sample. */
const isRealLookingValue = (value: string): boolean => value.length >= 16 && !isPlaceholder(value) && !isSampleCredential(value);

const ASSIGNMENT_RULES: readonly AssignmentRule[] = [
  { regex: /Bearer\s+[A-Za-z0-9\-._~+/]+=*(?=\s|$)/g, type: "bearer_token", confidence: 0.75, description: "Bearer authentication token" },
  { regex: /(password|passwd|pwd)\s*[=:]\s*(['"])([^'"]+)\2/gi, type: "password", confidence: 0.7, description: "Password assignment", valueGroup: 3 },
  {
    regex: /(DATABASE_URL|DB_PASSWORD|DATABASE_PASSWORD)\s*[=:]\s*(['"])([^'"]+)\2/gi,
    type: "db_credential", confidence: 0.85, description: "Database connection credential", valueGroup: 3,
    blocking: (value, match) => isExposedEnvValue(match[1] ?? "DATABASE_URL", value, new Set()) && !isSampleCredential(value),
  },
  {
    regex: /(['"]?)oauth_token\1\s*[=:]\s*(['"])([^'"]+)\2/gi, type: "oauth_token", confidence: 0.9,
    description: "OAuth access token", valueGroup: 3, blocking: isRealLookingValue,
  },
  { regex: /\b\d{1,5}[-.]?\d{1,5}[-.]?\d{1,5}[-.]?\d{1,5}\b(?![\d.-])/g, type: "pii", confidence: 0.5, description: "Potential IP address or SSN-like pattern", heuristic: true },
  {
    regex: /webhook_secret\s*[=:]\s*(['"])([^'"]+)\1/gi, type: "webhook_secret", confidence: 0.9,
    description: "Webhook secret key", valueGroup: 2, blocking: isRealLookingValue,
  },
];

interface TextRule {
  regex: RegExp;
  type: SecretType;
  confidence: number;
  description: string;
  blocking: (value: string, match: RegExpMatchArray) => boolean;
  valueGroup?: number | undefined;
  heuristic: boolean;
  verify?: ((match: string) => boolean) | undefined;
}

/** Token formats first (most specific), then assignments, in a stable order. */
const TEXT_RULES: readonly TextRule[] = [
  ...TOKEN_FORMATS.map((format): TextRule => ({
    regex: new RegExp(format.source, "g"),
    type: format.type,
    confidence: format.confidence,
    description: format.description,
    blocking: () => format.blocking,
    heuristic: false,
    verify: format.verify,
  })),
  ...ASSIGNMENT_RULES.map((rule): TextRule => ({
    regex: rule.regex,
    type: rule.type,
    confidence: rule.confidence,
    description: rule.description,
    blocking: rule.blocking ?? (() => false),
    valueGroup: rule.valueGroup,
    heuristic: rule.heuristic ?? false,
  })),
];

/** Mask a secret so only its edges remain (short values are masked completely). */
export function maskSecret(secret: string): string {
  if (secret.length <= 8) return "*".repeat(secret.length);
  return `${secret.substring(0, 2)}${"*".repeat(Math.max(3, secret.length - 5))}${secret.substring(secret.length - 3)}`;
}

function lineOf(content: string, index: number): number {
  return content.substring(0, index).split("\n").length;
}

function toMatch(rule: TextRule, match: RegExpMatchArray, content: string, options: FindSecretsOptions): SecretMatch {
  const matchedText = match[0];
  const value = rule.valueGroup === undefined ? matchedText : (match[rule.valueGroup] ?? matchedText);
  const line = options.line ?? (match.index === undefined ? undefined : lineOf(content, match.index));
  return {
    type: rule.type,
    pattern: maskSecret(matchedText),
    file: options.file,
    line,
    confidence: rule.confidence,
    description: rule.description,
    blocking: rule.blocking(value, match),
  };
}

function isDroppedPlaceholder(rule: TextRule, match: RegExpMatchArray, options: FindSecretsOptions): boolean {
  if (!options.ignorePlaceholders || rule.valueGroup === undefined) return false;
  const value = match[rule.valueGroup];
  return value !== undefined && isPlaceholder(value);
}

/**
 * Find secrets in text, including whether each is strong enough to block a commit.
 *
 * @param content - Text to scan (a whole file, or a single line)
 * @param options - File/line to report and filtering switches
 * @returns One entry per distinct (type, text) match, in rule order
 */
export function findSecrets(content: string, options: FindSecretsOptions = {}): SecretMatch[] {
  const found: SecretMatch[] = [];
  const seen = new Set<string>();
  for (const rule of TEXT_RULES) {
    if (rule.heuristic && options.includeHeuristics === false) continue;
    for (const match of content.matchAll(rule.regex)) {
      if (rule.verify && !rule.verify(match[0])) continue;
      if (isDroppedPlaceholder(rule, match, options)) continue;
      const key = `${rule.type}:${match[0]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push(toMatch(rule, match, content, options));
    }
  }
  return found;
}

/**
 * Detect secrets in text content (every rule, placeholders included).
 *
 * @param content - Text content to scan for secrets
 * @param fileInfo - Optional file location information
 * @returns Array of detected secrets
 *
 * @example
 * ```typescript
 * const secrets = detectSecretsInText(`.env file content`, { file: '.env.example', line: 1 });
 * secrets.forEach(secret => console.log(`Found ${secret.type}: ${secret.description}`));
 * ```
 */
export function detectSecretsInText(content: string, fileInfo?: { file?: string; line?: number }): DetectedSecret[] {
  return findSecrets(content, { file: fileInfo?.file, line: fileInfo?.line }).map((match) => ({
    type: match.type,
    pattern: match.pattern,
    file: match.file,
    line: match.line,
    confidence: match.confidence,
    description: match.description,
  }));
}

/**
 * Scan environment variables for secrets.
 *
 * @param envObject - Object with environment variables
 * @returns Array of detected secrets
 */
export function detectSecretsInEnv(envObject: Record<string, string | undefined>): DetectedSecret[] {
  const secrets: DetectedSecret[] = [];
  const namePatterns = ["key", "secret", "password", "token", "api"];

  for (const [key, value] of Object.entries(envObject)) {
    if (!value) continue;

    if (namePatterns.some((pattern) => key.toLowerCase().includes(pattern))) {
      secrets.push({
        type: "api_key",
        pattern: maskSecret(value),
        confidence: 0.6,
        description: `Environment variable "${key}" contains sensitive-looking name`,
      });
    }

    for (const detected of detectSecretsInText(value)) secrets.push({ ...detected, file: key });
  }

  return secrets;
}

/** Risk assessment for a set of detected secrets. */
export interface SecretRisk {
  totalFound: number;
  criticalCount: number;
  highConfidence: DetectedSecret[];
  risk: "critical" | "high" | "medium" | "low" | "safe";
}

const CRITICAL_TYPES: readonly SecretType[] = ["private_key", "api_key", "password"];

/**
 * Get risk assessment for detected secrets.
 *
 * @param secrets - Array of detected secrets
 * @returns Risk assessment object
 */
export function assessSecretRisk(secrets: DetectedSecret[]): SecretRisk {
  const highConfidence = secrets.filter((s) => s.confidence >= 0.8);
  const criticalCount = secrets.filter((s) => CRITICAL_TYPES.includes(s.type)).length;

  let risk: SecretRisk["risk"] = "safe";
  if (criticalCount > 0) risk = "critical";
  else if (highConfidence.length > 0) risk = "high";
  else if (secrets.length > 3) risk = "medium";
  else if (secrets.length > 0) risk = "low";

  return { totalFound: secrets.length, criticalCount, highConfidence, risk };
}

// ---------------------------------------------------------------------------
// Whole-value classification for env and package entries
// ---------------------------------------------------------------------------

/**
 * Tokenize key.
 *
 * @param key - Key
 * @returns Tokenize key result
 */
export function tokenizeKey(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word.toUpperCase());
}

/**
 * Is sensitive key.
 *
 * @param key - Key
 * @param muraqibKeys - Muraqib keys
 * @returns Is sensitive key result
 */
export function isSensitiveKey(key: string, muraqibKeys: ReadonlySet<string>): boolean {
  if (muraqibKeys.has(key.toUpperCase())) return true;

  const words = tokenizeKey(key);
  const last = words[words.length - 1];
  if (last !== undefined && NON_SECRET_KEY_SUFFIXES.has(last)) return false;

  if (words.some((word) => SENSITIVE_KEY_WORDS.has(word))) return true;
  for (let i = 0; i < words.length - 1; i++) {
    if (SENSITIVE_KEY_PAIRS.some(([a, b]) => words[i] === a && words[i + 1] === b)) return true;
  }
  return false;
}

/**
 * Is placeholder.
 *
 * @param value - Value
 * @returns Is placeholder result
 */
export function isPlaceholder(value: string): boolean {
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(value));
}

/**
 * Is non secret literal.
 *
 * @param value - Value
 * @returns Is non secret literal result
 */
export function isNonSecretLiteral(value: string): boolean {
  return /^(?:true|false|yes|no|on|off)$/i.test(value) || /^\d+(?:\.\d+)?$/.test(value);
}

/**
 * Try parse url.
 *
 * @param value - Value
 * @returns Try parse url result
 */
export function tryParseUrl(value: string): URL | undefined {
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return undefined;
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

/**
 * Url carries secret.
 *
 * @param url - Url
 * @returns Url carries secret result
 */
export function urlCarriesSecret(url: URL): boolean {
  if (url.password !== "" && !isPlaceholder(safeDecode(url.password))) return true;
  for (const [name, value] of url.searchParams) {
    if (value !== "" && !isPlaceholder(value) && isSensitiveKey(name, new Set())) return true;
  }
  return false;
}

/**
 * Shannon entropy.
 *
 * @param value - Value
 * @returns Shannon entropy result
 */
export function shannonEntropy(value: string): number {
  const counts = new Map<string, number>();
  for (const ch of value) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / value.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

/**
 * Looks like high entropy secret.
 *
 * @param value - Value
 * @returns Looks like high entropy secret result
 */
export function looksLikeHighEntropySecret(value: string): boolean {
  if (value.length < 20 || /\s/.test(value)) return false;
  if (value.includes("://") || /^(?:[A-Za-z]:)?[\\/~.]/.test(value)) return false;
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(value)).length;
  return classes >= 3 && shannonEntropy(value) >= 3.5;
}

/**
 * Matches secret pattern.
 *
 * @param value - Value
 * @returns Matches secret pattern result
 */
export function matchesSecretPattern(value: string): boolean {
  if (SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value))) return true;
  const url = tryParseUrl(value);
  return url !== undefined && urlCarriesSecret(url);
}

/**
 * Is exposed env value.
 *
 * @param key - Key
 * @param rawValue - Raw value
 * @param muraqibKeys - Muraqib keys
 * @returns Is exposed env value result
 */
export function isExposedEnvValue(key: string, rawValue: string, muraqibKeys: ReadonlySet<string>): boolean {
  const value = rawValue.trim();
  if (value === "" || isPlaceholder(value)) return false;
  if (muraqibKeys.has(key.toUpperCase())) return true;
  if (matchesSecretPattern(value)) return true;
  if (tryParseUrl(value) !== undefined) return false;
  if (isNonSecretLiteral(value)) return false;
  if (isSensitiveKey(key, muraqibKeys)) return true;
  return looksLikeHighEntropySecret(value);
}

/**
 * Is exposed package value.
 *
 * @param key - Key
 * @param rawValue - Raw value
 * @returns Is exposed package value result
 */
export function isExposedPackageValue(key: string, rawValue: string): boolean {
  const value = rawValue.trim();
  if (value === "" || isPlaceholder(value)) return false;
  if (matchesSecretPattern(value)) return true;
  if (tryParseUrl(value) !== undefined || isNonSecretLiteral(value)) return false;
  return isSensitiveKey(key, new Set());
}
