export interface VariableMetadata {
  name: string;
  classification: string;
  hasCredentials: boolean;
  formatValid: boolean;
  length: number;
}

const SENSITIVE_KEY_PATTERN =
  /(key|secret|token|password|passwd|credential|private|auth|cert|access)/i;

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key);
}

export function isSensitiveValue(value: string): boolean {
  if (!value) return false;

  // URL with credentials (e.g. postgres://user:pass@host/db)
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^@/\s]+:[^@/\s]+@/i.test(value)) {
    return true;
  }

  // JWT pattern (ey...)
  if (/^ey[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*$/.test(value)) {
    return true;
  }

  // Private key markers
  if (value.includes("BEGIN PRIVATE KEY") || value.includes("BEGIN RSA PRIVATE KEY")) {
    return true;
  }

  return false;
}

export function redactValue(key: string, value: string): string {
  if (isSensitiveKey(key) || isSensitiveValue(value)) {
    return "[REDACTED]";
  }
  return value;
}

export function extractSafeMetadata(key: string, value: string): VariableMetadata {
  const hasCredentials = isSensitiveKey(key) || isSensitiveValue(value);
  let classification = "custom-string";
  let formatValid = true;

  if (key.endsWith("_URL") || key.endsWith("_URI")) {
    classification = "url";
    try {
      new URL(value);
    } catch {
      formatValid = false;
    }
  } else if (key.endsWith("_PORT") || key === "PORT") {
    classification = "port";
    const p = Number(value);
    formatValid = !isNaN(p) && p > 0 && p <= 65535;
  } else if (hasCredentials) {
    classification = "credential-secret";
  }

  return {
    name: key,
    classification,
    hasCredentials,
    formatValid,
    length: value.length,
  };
}
