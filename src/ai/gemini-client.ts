import type { GoogleGenAI } from "@google/genai";
import { warn } from "../shared/logger.js";
import { loadOptionalDependency, MissingOptionalDependencyError } from "../utils/optional-dependency.js";

/**
 * Lazily load the optional `@google/genai` peer dependency and build a client.
 * @throws MissingOptionalDependencyError when `@google/genai` is not installed
 */
export async function createGeminiClient(apiKey: string): Promise<GoogleGenAI> {
  const { GoogleGenAI: Client } = await loadOptionalDependency<typeof import("@google/genai")>(
    "@google/genai",
    "the Gemini AI advisor"
  );
  return new Client({ apiKey });
}

let missingGenAIWarned = false;

/** Warn (once per process) that the optional AI advisor is disabled because its dependency is missing. */
export function warnIfGenAIMissing(error: unknown): void {
  if (error instanceof MissingOptionalDependencyError && !missingGenAIWarned) {
    missingGenAIWarned = true;
    warn(`[muraqib] AI advisor disabled: ${error.message}`);
  }
}
