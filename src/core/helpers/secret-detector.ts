/**
 * Secret detection helpers for environment and package scanning.
 * Separated from config-guard.ts to reduce bundle size.
 */

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

const SECRET_VALUE_PATTERNS: readonly RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/, // JWT
  /^(?:AKIA|ASIA)[0-9A-Z]{16}$/, // AWS
  /^gh[pousr]_[A-Za-z0-9]{30,}$/, // GitHub
  /^sk-[A-Za-z0-9_-]{20,}$/, // OpenAI-style
  /^xox[baprs]-[A-Za-z0-9-]{10,}$/, // Slack
  /^AIza[0-9A-Za-z_-]{35}$/, // Google API
];

export function tokenizeKey(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word.toUpperCase());
}

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

export function isPlaceholder(value: string): boolean {
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(value));
}

export function isNonSecretLiteral(value: string): boolean {
  return /^(?:true|false|yes|no|on|off)$/i.test(value) || /^\d+(?:\.\d+)?$/.test(value);
}

export function tryParseUrl(value: string): URL | undefined {
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return undefined;
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

export function urlCarriesSecret(url: URL): boolean {
  if (url.password !== "" && !isPlaceholder(decodeURIComponent(url.password))) return true;
  for (const [name, value] of url.searchParams) {
    if (value !== "" && !isPlaceholder(value) && isSensitiveKey(name, new Set())) return true;
  }
  return false;
}

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

export function looksLikeHighEntropySecret(value: string): boolean {
  if (value.length < 20 || /\s/.test(value)) return false;
  if (value.includes("://") || /^(?:[A-Za-z]:)?[\\/~.]/.test(value)) return false;
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(value)).length;
  return classes >= 3 && shannonEntropy(value) >= 3.5;
}

export function matchesSecretPattern(value: string): boolean {
  if (SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value))) return true;
  const url = tryParseUrl(value);
  return url !== undefined && urlCarriesSecret(url);
}

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

export function isExposedPackageValue(key: string, rawValue: string): boolean {
  const value = rawValue.trim();
  if (value === "" || isPlaceholder(value)) return false;
  if (matchesSecretPattern(value)) return true;
  if (tryParseUrl(value) !== undefined || isNonSecretLiteral(value)) return false;
  return isSensitiveKey(key, new Set());
}
