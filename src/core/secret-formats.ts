/**
 * Secret types and the shared table of known token formats.
 *
 * One table feeds both free-text scanning (`secret-detector`) and whole-value checks
 * (`secret-values`), so a format added once is recognised everywhere. Pure: no I/O.
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
// Token formats: one table feeds both free-text scanning and whole-value checks
// ---------------------------------------------------------------------------

/** How a token format is recognised when it is the entire value of an env/package entry. */
export type ValueForm = "anchored" | "contains" | "none";

export interface TokenFormat {
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

export const TOKEN_FORMATS: readonly TokenFormat[] = [
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
export const SECRET_VALUE_PATTERNS: readonly RegExp[] = TOKEN_FORMATS.flatMap((format) => {
  if (format.valueForm === "none") return [];
  return [new RegExp(format.valueForm === "anchored" ? `^(?:${format.source})$` : format.source)];
});
