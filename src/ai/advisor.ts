/**
 * @file src/ai/advisor.ts
 * @description AI-powered advisory and remediation suggestions for audit findings
 *
 * Provides intelligent recommendations using the Google Generative AI API
 * to help developers fix detected issues with context-aware solutions.
 */

import { GoogleGenAI } from "@google/genai";
import type { AuditResult, AuditIssue } from "../core/types.js";

/**
 * Configuration for AI advisor
 */
export interface AIAdvisorConfig {
  /** Google API key for Gemini */
  apiKey?: string;
  /** Model to use (default: "gemini-1.5-flash") */
  model?: string;
  /** Maximum tokens in response */
  maxTokens?: number;
  /** Temperature for creativity (0-1) */
  temperature?: number;
}

/**
 * Advisory suggestion from AI
 */
export interface AdvisorySuggestion {
  /** Issue code this addresses */
  issueCode: string;
  /** AI-generated recommendation text */
  recommendation: string;
  /** Code example if applicable */
  codeExample?: string;
  /** Link to documentation */
  docLink?: string;
  /** Priority level (1-5, 5 is highest) */
  priority: number;
  /** Estimated fix time in minutes */
  estimatedTime?: number;
}

/**
 * Result of advisory analysis
 */
export interface AdvisoryResult {
  /** Whether advisory was successful */
  success: boolean;
  /** Suggestions generated */
  suggestions: AdvisorySuggestion[];
  /** Error message if any */
  error?: string;
  /** Time taken in milliseconds */
  duration: number;
}

/**
 * Generate AI-powered advisory suggestions for audit findings
 *
 * @param issues - Array of audit issues to analyze
 * @param config - AI advisor configuration
 * @returns Promise resolving to advisory suggestions
 *
 * @example
 * ```typescript
 * const issues: AuditIssue[] = [
 *   {
 *     code: 'SEC_001',
 *     severity: 'error',
 *     title: 'Missing Security Header',
 *     message: 'X-Content-Type-Options header not set',
 *   }
 * ];
 *
 * const advisory = await generateAdvisory(issues, {
 *   apiKey: process.env.GOOGLE_API_KEY,
 * });
 *
 * advisory.suggestions.forEach(s => {
 *   console.log(`${s.issueCode}: ${s.recommendation}`);
 * });
 * ```
 */
export async function generateAdvisory(
  issues: AuditIssue[],
  config: AIAdvisorConfig = {}
): Promise<AdvisoryResult> {
  const startTime = Date.now();

  try {
    // Use provided API key or environment variable
    const apiKey = config.apiKey || process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      return {
        success: false,
        suggestions: [],
        error: "Google API key not provided",
        duration: Date.now() - startTime,
      };
    }

    // Filter out empty issues
    const filteredIssues = issues.filter((issue) => {
      return issue && issue.code && issue.message;
    });

    if (filteredIssues.length === 0) {
      return {
        success: true,
        suggestions: [],
        duration: Date.now() - startTime,
      };
    }

    // Initialize Generative AI client
    const client = new GoogleGenAI({ apiKey });

    // Build prompt for AI
    const issueDescriptions = filteredIssues
      .map(
        (issue) =>
          `Code: ${issue.code}\nSeverity: ${issue.severity}\nTitle: ${issue.title}\nMessage: ${issue.message}`
      )
      .join("\n\n");

    const prompt = `You are an expert DevSecOps advisor. Analyze these audit findings and provide concise, actionable remediation suggestions for each issue.

Issues to analyze:
${issueDescriptions}

For each issue, provide:
1. A specific recommendation (1-2 sentences)
2. If applicable, a code example (short and direct)
3. Priority level (1-5, where 5 is critical)
4. Estimated fix time in minutes

Format as JSON array with fields: issueCode, recommendation, codeExample, priority, estimatedTime`;

    const response = await client.models.generateContent({
      model: config.model ?? "gemini-1.5-flash",
      contents: [
        {
          role: "user",
          parts: [
            {
              text: prompt,
            },
          ],
        },
      ],
    });

    // Extract text from response
    let text: string = "";
    if (
      response &&
      typeof response === "object" &&
      "candidates" in response &&
      Array.isArray(response.candidates) &&
      response.candidates.length > 0
    ) {
      const candidate = response.candidates[0];
      if (
        candidate &&
        typeof candidate === "object" &&
        "content" in candidate &&
        candidate.content &&
        typeof candidate.content === "object" &&
        "parts" in candidate.content &&
        Array.isArray(candidate.content.parts) &&
        candidate.content.parts.length > 0
      ) {
        const part = candidate.content.parts[0];
        if (
          part &&
          typeof part === "object" &&
          "text" in part &&
          typeof part.text === "string"
        ) {
          text = part.text;
        }
      }
    }

    // Parse AI response - extract JSON from markdown code blocks if present
    let jsonText: string = text;
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch && jsonMatch[1]) {
      jsonText = jsonMatch[1];
    }

    const suggestions = parseAdvisorySuggestions(jsonText);

    return {
      success: true,
      suggestions,
      duration: Date.now() - startTime,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    return {
      success: false,
      suggestions: [],
      error: errorMessage,
      duration: Date.now() - startTime,
    };
  }
}

/**
 * Parse AI response to extract advisory suggestions
 *
 * @param jsonText - JSON text from AI response
 * @returns Array of parsed suggestions
 */
function parseAdvisorySuggestions(jsonText: string): AdvisorySuggestion[] {
  try {
    // Try to parse as direct JSON array
    const parsed: unknown = JSON.parse(jsonText);
    if (!Array.isArray(parsed)) {
      return [];
    }

    const suggestions: AdvisorySuggestion[] = [];
    for (const item of parsed) {
      if (
        typeof item !== "object" ||
        item === null ||
        !("issueCode" in item) ||
        !("recommendation" in item)
      ) {
        continue;
      }

      const typed = item as Record<string, unknown>;
      const suggestion: AdvisorySuggestion = {
        issueCode: String(typed.issueCode ?? ""),
        recommendation: String(typed.recommendation ?? ""),
        priority: Math.min(
          5,
          Math.max(1, Number(typed.priority) || 3)
        ) as number,
      };

      if (
        typed.codeExample &&
        typeof typed.codeExample === "string"
      ) {
        suggestion.codeExample = typed.codeExample;
      }

      if (typed.docLink && typeof typed.docLink === "string") {
        suggestion.docLink = typed.docLink;
      }

      if (
        typed.estimatedTime &&
        typeof typed.estimatedTime === "number"
      ) {
        suggestion.estimatedTime = typed.estimatedTime;
      }

      suggestions.push(suggestion);
    }

    return suggestions;
  } catch {
    return [];
  }
}

/**
 * Generate advisory for a complete audit result
 *
 * @param auditResult - Full audit result with all issues
 * @param config - AI advisor configuration
 * @returns Promise resolving to advisory result
 */
export async function generateAuditAdvisory(
  auditResult: AuditResult,
  config: AIAdvisorConfig = {}
): Promise<AdvisoryResult> {
  // Filter to critical and error issues only for efficiency
  const importantIssues = auditResult.issues.filter(
    (issue) => issue.severity === "critical" || issue.severity === "error"
  );

  return generateAdvisory(importantIssues, config);
}
