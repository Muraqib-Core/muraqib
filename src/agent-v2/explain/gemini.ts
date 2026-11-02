import { createGeminiClient } from "../../ai/gemini-client.js";
import { GEMINI_MODEL } from "./config.js";

/** The one capability the explainer needs from an LLM; tests replace it with a mock. */
export interface TextGenerator {
  /**
   * Sends one prompt to the model.
   *
   * @param request - System instruction and user prompt
   * @returns The raw model text (empty string when the model returned none)
   */
  generate(request: { system: string; prompt: string }): Promise<string>;
}

/** True for a rate-limit / quota error (HTTP 429, `RESOURCE_EXHAUSTED`). */
export function isRateLimitError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const status = (error as { status?: unknown }).status;
  if (status === 429) return true;
  const message = String((error as { message?: unknown }).message ?? "");
  return /\b429\b|RESOURCE_EXHAUSTED/i.test(message);
}

/**
 * Builds the real Gemini-backed generator. Lazy: `@google/genai` is an optional peer
 * dependency, so a missing package surfaces as a `MissingOptionalDependencyError` here.
 */
export async function createGeminiTextGenerator(apiKey: string): Promise<TextGenerator> {
  const client = await createGeminiClient(apiKey);
  return {
    async generate({ system, prompt }): Promise<string> {
      const response = await client.models.generateContent({
        model: GEMINI_MODEL,
        contents: prompt,
        config: {
          systemInstruction: system,
          responseMimeType: "application/json",
          temperature: 0.2,
          maxOutputTokens: 2048,
          thinkingConfig: { thinkingBudget: 0 },
        },
      });
      return response.text ?? "";
    },
  };
}
