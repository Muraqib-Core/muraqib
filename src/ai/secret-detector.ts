/**
 * Secret Detector - Detects secrets in AI-generated code
 * Based on Jenan's implementation
 */

export interface SecretPattern {
  name: string;
  pattern: RegExp;
  severity: "critical" | "high";
}

const secretPatterns: SecretPattern[] = [
  {
    name: "API_KEY",
    pattern: /(?:api[_-]?key|apikey)\s*[:=]\s*['"]*[a-zA-Z0-9_-]{20,}['"]*$/gim,
    severity: "critical",
  },
  {
    name: "DATABASE_URL",
    pattern: /(?:database|db)[_-]?(?:url|connection|string)\s*[:=]\s*(?:mongodb|postgres|mysql|sqlite):\/\/[^\s]+/gim,
    severity: "critical",
  },
  {
    name: "JWT_TOKEN",
    pattern: /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
    severity: "high",
  },
  {
    name: "PRIVATE_KEY",
    pattern: /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----[\s\S]+?-----END\s+(?:RSA\s+)?PRIVATE\s+KEY-----/gim,
    severity: "critical",
  },
];

export async function detectSecrets(code: string): Promise<Array<{
  pattern: string;
  line: number;
  severity: "critical" | "high";
  details: string;
}>> {
  const results: Array<{
    pattern: string;
    line: number;
    severity: "critical" | "high";
    details: string;
  }> = [];

  const lines = code.split("\n");

  for (const secretPattern of secretPatterns) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line && secretPattern.pattern.test(line)) {
        results.push({
          pattern: secretPattern.name,
          line: i + 1,
          severity: secretPattern.severity,
          details: `Found ${secretPattern.name} pattern at line ${i + 1}`,
        });
      }
    }
  }

  return results;
}
