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
 * A short, safe reason for a failed Gemini request, shown to the user instead of the raw error.
 * Only an HTTP status, a fixed hint and an upper-case network code (such as `ENOTFOUND`) can appear:
 * the SDK's message text is used for classification only and is never copied, because it could
 * echo request details.
 */
export function describeGeminiError(error: unknown): string {
  const base = "Gemini request failed";
  if (typeof error !== "object" || error === null) return base;
  const { status, message, cause, code } = error as { status?: unknown; message?: unknown; cause?: unknown; code?: unknown };
  const text = String(message ?? "");
  if (typeof status === "number") {
    if (status === 400 && /API key not valid|API_KEY_INVALID/i.test(text)) return `${base} (HTTP 400: the API key was rejected as invalid)`;
    const hints: Record<number, string> = {
      400: "the request was rejected; the key type or the request format may not be accepted",
      401: "authentication failed; this key type or value is not accepted",
      403: "permission denied; the key may be restricted, or the Gemini API is not enabled for its project",
      404: "model not found; the configured model is not available for this key",
    };
    const hint = hints[status] ?? (status >= 500 ? "Gemini server error; try again later" : "unexpected response");
    return `${base} (HTTP ${status}: ${hint})`;
  }
  const inner = typeof cause === "object" && cause !== null ? (cause as { code?: unknown }).code : undefined;
  const networkCode = [code, inner].find((c): c is string => typeof c === "string" && /^[A-Z][A-Z0-9_]{3,}$/.test(c));
  return networkCode === undefined ? base : `${base} (network error ${networkCode}: check your internet connection or proxy)`;
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
