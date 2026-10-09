/**
 * @file src/ai/fallback.ts
 * @description Fallback advisory system when AI API is unavailable
 *
 * Provides rule-based remediation suggestions without external dependencies.
 * Useful as a backup when Google Generative AI service is down or rate-limited.
 */

import type { AuditIssue } from "../core/types.js";
import type { AdvisorySuggestion } from "./advisor.js";
import { resolveApiKey } from "./advisor.js";
import { extractSafeMetadata } from "./safe-metadata.js";
import { GoogleGenAI } from "@google/genai";

/**
 * Rule-based suggestion for a specific issue type
 */
interface FallbackSuggestionRule {
  /** Code pattern to match */
  codePattern: RegExp;
  /** Suggested recommendation */
  recommendation: string;
  /** Code example (optional) */
  codeExample?: string;
  /** Priority (1-5) */
  priority: number;
  /** Estimated fix time in minutes */
  estimatedTime?: number;
}

/**
 * Fallback suggestions database (rule-based)
 */
const FALLBACK_SUGGESTIONS: Record<string, FallbackSuggestionRule> = {
  SEC_001: {
    codePattern: /security[_-]?header/i,
    recommendation:
      "Add missing security headers (X-Content-Type-Options, X-Frame-Options, etc.) to your Express middleware or server configuration.",
    codeExample:
      'app.use((req, res, next) => { res.setHeader("X-Content-Type-Options", "nosniff"); next(); });',
    priority: 5,
    estimatedTime: 10,
  },
  SEC_002: {
    codePattern: /sql[_-]?injection/i,
    recommendation:
      "Use parameterized queries or prepared statements instead of string concatenation for database queries.",
    codeExample:
      "db.query('SELECT * FROM users WHERE id = ?', [userId], (err, result) => {});",
    priority: 5,
    estimatedTime: 20,
  },
  MEM_001: {
    codePattern: /memory[_-]?leak/i,
    recommendation:
      "Review event listeners and timers. Ensure they are properly cleaned up in component unmount or server shutdown handlers.",
    codeExample:
      "process.on('exit', () => { clearInterval(interval); emitter.removeAllListeners(); });",
    priority: 4,
    estimatedTime: 30,
  },
  DEP_001: {
    codePattern: /circular[_-]?depend/i,
    recommendation:
      "Reorganize code to remove circular dependencies. Consider extracting common utilities to a separate module.",
    priority: 3,
    estimatedTime: 45,
  },
  DEP_002: {
    codePattern: /deprecated/i,
    recommendation:
      "Replace deprecated APIs with their modern equivalents. Check the library documentation for migration guides.",
    priority: 3,
    estimatedTime: 25,
  },
  ASYNC_001: {
    codePattern: /floating[_-]?promise/i,
    recommendation:
      'Add "await" keyword to promise-returning functions, or use ".catch()" to handle errors explicitly.',
    codeExample: "await asyncFunction(); // or asyncFunction().catch(console.error);",
    priority: 4,
    estimatedTime: 15,
  },
  CONFIG_001: {
    codePattern: /missing[_-]?config/i,
    recommendation:
      "Verify all required configuration variables are defined. Check .env.example or documentation for required keys.",
    priority: 3,
    estimatedTime: 20,
  },
  PERF_001: {
    codePattern: /bundle[_-]?size/i,
    recommendation:
      "Audit and optimize bundle size using tools like webpack-bundle-analyzer. Remove unused dependencies and use code splitting.",
    priority: 2,
    estimatedTime: 60,
  },
  PERF_002: {
    codePattern: /dead[_-]?code/i,
    recommendation:
      "Remove unused functions, exports, and variables. Run ESLint with no-unused-vars rule to identify dead code automatically.",
    priority: 2,
    estimatedTime: 30,
  },
};

/**
 * Generic fallback suggestions by severity
 */
const GENERIC_SUGGESTIONS: Record<string, AdvisorySuggestion> = {
  critical: {
    issueCode: "GENERIC_CRITICAL",
    recommendation:
      "This is a critical issue that requires immediate attention. Review the error details carefully and address the root cause before deployment.",
    priority: 5,
    estimatedTime: 120,
  },
  error: {
    issueCode: "GENERIC_ERROR",
    recommendation:
      "This error should be fixed before deployment. Check related documentation or error logs for more details on resolution steps.",
    priority: 4,
    estimatedTime: 60,
  },
  warning: {
    issueCode: "GENERIC_WARNING",
    recommendation:
      "This warning indicates a potential issue that could impact functionality. Plan to address it in the next development cycle.",
    priority: 2,
    estimatedTime: 45,
  },
  info: {
    issueCode: "GENERIC_INFO",
    recommendation:
      "This is an informational finding. Consider addressing it as part of code improvements or optimization.",
    priority: 1,
    estimatedTime: 30,
  },
};

/**
 * Generate fallback suggestions when AI is unavailable
 *
 * @param issues - Array of audit issues
 * @returns Array of fallback suggestions
 *
 * @example
 * ```typescript
 * const issues: AuditIssue[] = [
 *   { code: 'SEC_001', severity: 'error', title: 'Missing Header', message: '...' }
 * ];
 * const suggestions = generateFallbackSuggestions(issues);
 * console.log(suggestions); // Rule-based recommendations
 * ```
 */
export function generateFallbackSuggestions(
  issues: AuditIssue[]
): AdvisorySuggestion[] {
  const suggestions: AdvisorySuggestion[] = [];

  for (const issue of issues) {
    // Try to find specific rule for this issue code
    const rule = FALLBACK_SUGGESTIONS[issue.code];

    if (rule && rule.codePattern.test(issue.message)) {
      suggestions.push({
        issueCode: issue.code,
        recommendation: rule.recommendation,
        codeExample: rule.codeExample,
        priority: rule.priority,
        estimatedTime: rule.estimatedTime,
      });
    } else if (rule) {
      // Use rule even if pattern doesn't match
      suggestions.push({
        issueCode: issue.code,
        recommendation: rule.recommendation,
        codeExample: rule.codeExample,
        priority: rule.priority,
        estimatedTime: rule.estimatedTime,
      });
    } else {
      // Use generic suggestion based on severity
      const generic =
        GENERIC_SUGGESTIONS[issue.severity] ??
        GENERIC_SUGGESTIONS.info;
      const genericSuggestion = generic as AdvisorySuggestion;
      suggestions.push({
        issueCode: issue.code,
        recommendation: genericSuggestion.recommendation,
        priority: genericSuggestion.priority,
        estimatedTime: genericSuggestion.estimatedTime,
      });
    }
  }

  return suggestions;
}

/**
 * Analyze unknown variables with fallback (no AI needed)
 *
 * @param unknownKeys - Variable names to analyze
 * @returns Array of suggestions for unknown variables
 */
export function analyzeUnknownVariablesWithFallback(
  unknownKeys: string[]
): AdvisorySuggestion[] {
  const suggestions: AdvisorySuggestion[] = [];

  for (const key of unknownKeys) {
    const upperKey = key.toUpperCase();

    // Check common variable patterns
    if (
      upperKey.includes("DATABASE") ||
      upperKey.includes("DB") ||
      upperKey.includes("SQL")
    ) {
      suggestions.push({
        issueCode: `UNKNOWN_VAR_${key}`,
        recommendation: `"${key}" appears to be a database configuration variable. Define it in your .env file with proper credentials.`,
        priority: 4,
        estimatedTime: 15,
      });
    } else if (
      upperKey.includes("API") ||
      upperKey.includes("KEY") ||
      upperKey.includes("SECRET")
    ) {
      suggestions.push({
        issueCode: `UNKNOWN_VAR_${key}`,
        recommendation: `"${key}" appears to be an API key or secret. Add it to your .env file and ensure it's never committed to version control.`,
        priority: 5,
        estimatedTime: 10,
      });
    } else if (
      upperKey.includes("PORT") ||
      upperKey.includes("HOST") ||
      upperKey.includes("URL")
    ) {
      suggestions.push({
        issueCode: `UNKNOWN_VAR_${key}`,
        recommendation: `"${key}" is a server configuration variable. Define it in your .env with appropriate values for your environment.`,
        priority: 3,
        estimatedTime: 10,
      });
    } else {
      suggestions.push({
        issueCode: `UNKNOWN_VAR_${key}`,
        recommendation: `Variable "${key}" is not defined. Add it to your .env file or check the variable name for typos.`,
        priority: 2,
        estimatedTime: 5,
      });
    }
  }

  return suggestions;
}

/**
 * Check if AI should be used or fallback is sufficient
 *
 * @param issueCount - Number of issues to analyze
 * @param isAIAvailable - Whether AI service is available
 * @returns Whether to use AI or fallback
 */
export function shouldUseAI(
  issueCount: number,
  isAIAvailable: boolean
): boolean {
  // Use AI for complex scenarios (many issues or high severity)
  // Use fallback for simple cases or when AI unavailable
  return isAIAvailable && issueCount > 2;
}

/**
 * Ask the AI to review unknown env variables. Only redacted structural metadata is sent;
 * values never leave the process. Fails closed (returns []) on any error.
 */
export async function analyzeUnknownVariablesWithAi(
  unknownKeys: string[],
  runtimeEnv: Record<string, string>
): Promise<{ path: string[]; message: string }[]> {
  const apiKey = resolveApiKey();
  if (!apiKey || unknownKeys.length === 0) return [];

  const safeMetadata = unknownKeys.map((key) => extractSafeMetadata(key, runtimeEnv[key] ?? ""));
  const prompt = `You are an expert DevSecOps Security Auditor.
Environment variables not covered by presets were detected. Analyze ONLY the structural metadata below for configuration risks or naming mistakes. Do not assume a variable is vulnerable because it is custom.

Safe Variable Metadata (values are not included):
${JSON.stringify(safeMetadata, null, 2)}

Only flag clear configuration errors. If everything looks normal return [].
Respond with ONLY a raw JSON array: [{"path": ["VARIABLE_NAME"], "message": "explanation"}]`;

  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: { responseMimeType: "application/json" },
    });
    const text = response.text?.trim();
    if (!text) return [];
    const parsed: unknown = JSON.parse(text);
    if (!Array.isArray(parsed)) return [];
    const out: { path: string[]; message: string }[] = [];
    for (const item of parsed) {
      if (
        typeof item === "object" && item !== null &&
        Array.isArray((item as { path?: unknown }).path) &&
        typeof (item as { message?: unknown }).message === "string"
      ) {
        out.push({
          path: (item as { path: unknown[] }).path.map(String),
          message: (item as { message: string }).message,
        });
      }
    }
    return out;
  } catch {
    return [];
  }
}
