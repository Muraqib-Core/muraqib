import { findSecrets } from "../../core/secret-detector.js";

const REDACTED = "[REDACTED]";

/** Patterns for credential formats; every match is replaced before anything leaves the machine. */
const SECRET_PATTERNS: readonly RegExp[] = [
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g,
  /\b(?:sk_live|pk_live)_[A-Za-z0-9]{10,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\b(?:AKIA|ASIA)[0-9A-Z]{12,}/g,
  /\bxox[baprs]-[A-Za-z0-9-]{8,}/g,
  /\bsk-[A-Za-z0-9_-]{16,}/g,
  /\bAIza[0-9A-Za-z_-]{20,}/g,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g,
  /\b[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s/@:]+:[^\s/@]+@/g,
  /\bBearer\s+[A-Za-z0-9\-._~+/]{8,}=*/gi,
];

/** `NAME_KEY = "value"` style assignments: keep the name, drop the value. */
const ASSIGNMENT = /(\b[A-Za-z0-9_]*(?:key|secret|token|password|passwd|pwd|credential)[A-Za-z0-9_]*\s*[:=]\s*)(["']?)[^\s"',;]{6,}\2/gi;

/**
 * Replaces anything that looks like a credential with `[REDACTED]`.
 *
 * @param text - Text about to be sent to an external service or written to a log
 * @param extraSecrets - Exact values that must never appear (for example the API key itself)
 * @returns The text with every secret removed
 */
export function redactText(text: string, extraSecrets: readonly string[] = []): string {
  let out = text;
  for (const pattern of SECRET_PATTERNS) out = out.replace(pattern, REDACTED);
  out = out.replace(ASSIGNMENT, `$1${REDACTED}`);
  for (const secret of extraSecrets) {
    if (secret.length >= 4) out = out.split(secret).join(REDACTED);
  }
  return out;
}

/**
 * Last line of defence: true when the final prompt still contains something the v1 secret
 * detector recognises. The caller must then skip the network call entirely.
 */
export function containsSecret(text: string): boolean {
  return findSecrets(text, { includeHeuristics: false, ignorePlaceholders: false }).length > 0;
}
