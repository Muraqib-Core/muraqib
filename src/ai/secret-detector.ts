/**
 * @file src/ai/secret-detector.ts
 * @description Advanced detection of sensitive data and secrets in code
 *
 * Uses pattern matching and heuristics to identify:
 * - API keys and authentication tokens
 * - Database credentials
 * - Private keys and certificates
 * - Passwords and secrets
 * - PII (Personally Identifiable Information)
 */

/**
 * Detected secret with location and severity
 */
export interface DetectedSecret {
  /** Type of secret (api_key, password, private_key, etc.) */
  type: SecretType;
  /** Matched pattern value (masked) */
  pattern: string;
  /** File location if found */
  file?: string;
  /** Line number if found */
  line?: number;
  /** Confidence level (0-1) */
  confidence: number;
  /** Description of the secret */
  description: string;
}

/**
 * Types of secrets that can be detected
 */
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

/**
 * Secret detection pattern
 */
interface SecretPattern {
  /** Regular expression to match */
  regex: RegExp;
  /** Secret type */
  type: SecretType;
  /** Confidence level (0-1) */
  confidence: number;
  /** Human-readable description */
  description: string;
}

/**
 * Patterns for detecting various secret types
 */
const SECRET_PATTERNS: SecretPattern[] = [
  {
    regex: /(['"]?)sk_live_[A-Za-z0-9]{20,40}\1/g,
    type: "api_key",
    confidence: 0.95,
    description: "Stripe secret key",
  },
  {
    regex: /(['"]?)pk_live_[A-Za-z0-9]{20,40}\1/g,
    type: "api_key",
    confidence: 0.9,
    description: "Stripe public key",
  },
  {
    regex: /(['"]?)ghp_[A-Za-z0-9]{36}\1/g,
    type: "api_key",
    confidence: 0.98,
    description: "GitHub personal access token",
  },
  {
    regex:
      /(['"]?)AKIA[0-9A-Z]{16}\1(?:\s*[=:]\s*(['"]?)[A-Za-z0-9/+=]{40}\2)?/g,
    type: "api_key",
    confidence: 0.95,
    description: "AWS access key ID",
  },
  {
    regex: /Bearer\s+[A-Za-z0-9\-._~+/]+=*(?=\s|$)/g,
    type: "bearer_token",
    confidence: 0.75,
    description: "Bearer authentication token",
  },
  {
    regex:
      /(password|passwd|pwd)\s*[=:]\s*(['"])([^'"]+)\2/gi,
    type: "password",
    confidence: 0.7,
    description: "Password assignment",
  },
  {
    regex: /-----BEGIN (RSA|DSA|EC)? PRIVATE KEY-----/g,
    type: "private_key",
    confidence: 0.99,
    description: "Private key PEM block",
  },
  {
    regex:
      /(DATABASE_URL|DB_PASSWORD|DATABASE_PASSWORD)\s*[=:]\s*(['"])([^'"]+)\2/gi,
    type: "db_credential",
    confidence: 0.85,
    description: "Database connection credential",
  },
  {
    regex: /(['"]?)oauth_token\1\s*[=:]\s*(['"])([^'"]+)\2/gi,
    type: "oauth_token",
    confidence: 0.9,
    description: "OAuth access token",
  },
  {
    regex:
      /\b\d{1,5}[-.]?\d{1,5}[-.]?\d{1,5}[-.]?\d{1,5}\b(?![\d.-])/g,
    type: "pii",
    confidence: 0.5,
    description: "Potential IP address or SSN-like pattern",
  },
  {
    regex: /-----BEGIN CERTIFICATE-----/g,
    type: "certificate",
    confidence: 0.98,
    description: "SSL/TLS certificate",
  },
  {
    regex: /webhook_secret\s*[=:]\s*(['"])([^'"]+)\1/gi,
    type: "webhook_secret",
    confidence: 0.9,
    description: "Webhook secret key",
  },
];

/**
 * Detect secrets in text content
 *
 * @param content - Text content to scan for secrets
 * @param fileInfo - Optional file location information
 * @returns Array of detected secrets
 *
 * @example
 * ```typescript
 * const secrets = detectSecretsInText(`.env file content`, {
 *   file: '.env.example',
 *   line: 1,
 * });
 *
 * secrets.forEach(secret => {
 *   console.log(`Found ${secret.type}: ${secret.description}`);
 * });
 * ```
 */
export function detectSecretsInText(
  content: string,
  fileInfo?: { file?: string; line?: number }
): DetectedSecret[] {
  const secrets: DetectedSecret[] = [];
  const processedPatterns = new Set<string>();

  for (const pattern of SECRET_PATTERNS) {
    try {
      // Reset regex lastIndex for global patterns
      pattern.regex.lastIndex = 0;
      let match: RegExpExecArray | null;

      while ((match = pattern.regex.exec(content)) !== null) {
        const matchedText = match[0];
        const patternKey = `${pattern.type}:${matchedText}`;

        // Skip duplicate patterns in same scan
        if (processedPatterns.has(patternKey)) {
          continue;
        }
        processedPatterns.add(patternKey);

        // Calculate line number if not provided
        let lineNum = fileInfo?.line;
        if (!lineNum && match.index >= 0) {
          lineNum = content.substring(0, match.index).split("\n").length;
        }

        // Mask the secret (show only first and last 2 chars)
        const maskedPattern = maskSecret(matchedText);

        secrets.push({
          type: pattern.type,
          pattern: maskedPattern,
          file: fileInfo?.file,
          line: lineNum,
          confidence: pattern.confidence,
          description: pattern.description,
        });
      }
    } catch {
      // Skip invalid regex patterns
      continue;
    }
  }

  return secrets;
}

/**
 * Scan environment variables for secrets
 *
 * @param envObject - Object with environment variables
 * @returns Array of detected secrets
 *
 * @example
 * ```typescript
 * const secrets = detectSecretsInEnv(process.env);
 * console.log(`Found ${secrets.length} potential secrets`);
 * ```
 */
export function detectSecretsInEnv(
  envObject: Record<string, string | undefined>
): DetectedSecret[] {
  const secrets: DetectedSecret[] = [];

  for (const [key, value] of Object.entries(envObject)) {
    if (!value) continue;

    // Check variable name patterns
    const namePatterns = ["key", "secret", "password", "token", "api"];
    const isSuspiciousName = namePatterns.some((pattern) =>
      key.toLowerCase().includes(pattern)
    );

    if (isSuspiciousName) {
      secrets.push({
        type: "api_key",
        pattern: maskSecret(value),
        confidence: 0.6,
        description: `Environment variable "${key}" contains sensitive-looking name`,
      });
    }

    // Scan value for patterns
    const detected = detectSecretsInText(value);
    detected.forEach((secret) => {
      secret.file = key;
    });
    secrets.push(...detected);
  }

  return secrets;
}

/**
 * Mask sensitive secret value showing only edges
 *
 * @param secret - The secret string to mask
 * @returns Masked version (e.g., "sk...xyz123")
 */
function maskSecret(secret: string): string {
  if (secret.length <= 4) {
    return "*".repeat(secret.length);
  }

  const first = secret.substring(0, 2);
  const last = secret.substring(secret.length - 3);
  const masked = "*".repeat(Math.max(3, secret.length - 5));

  return `${first}${masked}${last}`;
}

/**
 * Get risk assessment for detected secrets
 *
 * @param secrets - Array of detected secrets
 * @returns Risk assessment object
 */
export function assessSecretRisk(
  secrets: DetectedSecret[]
): {
  totalFound: number;
  criticalCount: number;
  highConfidence: DetectedSecret[];
  risk: "critical" | "high" | "medium" | "low" | "safe";
} {
  const highConfidence = secrets.filter((s) => s.confidence >= 0.8);
  const criticalTypes = ["private_key", "api_key", "password"];
  const criticalCount = secrets.filter((s) =>
    criticalTypes.includes(s.type)
  ).length;

  let risk: "critical" | "high" | "medium" | "low" | "safe";
  if (criticalCount > 0) {
    risk = "critical";
  } else if (highConfidence.length > 0) {
    risk = "high";
  } else if (secrets.length > 3) {
    risk = "medium";
  } else if (secrets.length > 0) {
    risk = "low";
  } else {
    risk = "safe";
  }

  return {
    totalFound: secrets.length,
    criticalCount,
    highConfidence,
    risk,
  };
}
