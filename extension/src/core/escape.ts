const HTML_ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
  "`": "&#96;",
};

/** Escape untrusted text for HTML element content and quoted attribute values. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"'`]/g, (ch) => HTML_ESCAPES[ch] ?? ch);
}

/** True for absolute http(s) URLs only, so `javascript:` and `data:` links are never accepted. */
export function isSafeUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

/** Matches the nonce shape accepted by the core renderer: at least 8 base64/base64url characters. */
const NONCE_PATTERN = /^[A-Za-z0-9+/_=-]{8,}$/;

/** True when `value` is safe to embed unescaped in a CSP header and a `nonce` attribute. */
export function isValidNonce(value: string): boolean {
  return NONCE_PATTERN.test(value);
}
