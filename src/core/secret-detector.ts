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

import { TOKEN_FORMATS } from "./secret-formats.js";
import type { DetectedSecret, FindSecretsOptions, SecretMatch, SecretType } from "./secret-formats.js";
import { isExposedEnvValue, isPlaceholder, safeDecode, tryParseUrl } from "./secret-values.js";

export type { DetectedSecret, FindSecretsOptions, SecretMatch, SecretType } from "./secret-formats.js";
export {
  isExposedEnvValue,
  isExposedPackageValue,
  isNonSecretLiteral,
  isPlaceholder,
  isSensitiveKey,
  looksLikeHighEntropySecret,
  matchesSecretPattern,
  shannonEntropy,
  tokenizeKey,
  tryParseUrl,
  urlCarriesSecret,
} from "./secret-values.js";

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


/** Passwords that appear in documentation and local setups rather than in production. */
const SAMPLE_CREDENTIALS = new Set([
  "password", "pass", "passwd", "secret", "changeme", "change-me", "123456", "12345678",
  "postgres", "root", "admin", "test", "example", "user", "username", "mysecret", "hunter2",
]);

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

