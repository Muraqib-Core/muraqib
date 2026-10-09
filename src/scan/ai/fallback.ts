import { GoogleGenAI } from "@google/genai";
import { extractSafeMetadata } from "./secret-detector.js";
import type { ValidationError } from "../core/contracts/validation-engine.js";

function getAiClient(): GoogleGenAI | null {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  return new GoogleGenAI({ apiKey: key });
}

export async function analyzeUnknownVariablesWithAi(
  unknownKeys: string[],
  runtimeEnv: Record<string, string>
): Promise<ValidationError[]> {
  const ai = getAiClient();
  if (!ai || unknownKeys.length === 0) return [];

  // Redact all sensitive information and send safe structural metadata
  const safeMetadata = unknownKeys.map((key) => {
    const val = runtimeEnv[key] ?? "";
    return extractSafeMetadata(key, val);
  });

  const prompt = `
You are an expert DevSecOps Security Auditor.
I have detected environment variables not covered by standard system presets.
Analyze the structural metadata of these variables for deployment configuration risks or naming mistakes.
DO NOT assume a variable is vulnerable just because it is custom.

Safe Variable Metadata (Values are not included for security):
${JSON.stringify(safeMetadata, null, 2)}

Strict Output Requirements:
1. Only flag clear configuration errors (e.g. malformed URL indicators, invalid port numbers, or suspicious configuration naming).
2. If metadata looks normal for custom business variables, return an empty array.
3. Your response MUST be a raw JSON array of objects matching:
   [{"path": ["VARIABLE_NAME"], "message": "Detailed error explanation."}]
4. Do NOT output markdown code blocks or additional text. Output ONLY the raw JSON array.
`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
      },
    });

    const responseText = response.text?.trim();
    if (!responseText) return [];

    // Parse and strictly validate the AI response schema
    const parsed: unknown = JSON.parse(responseText);
    if (!Array.isArray(parsed)) return [];

    const validatedErrors: ValidationError[] = [];
    for (const item of parsed) {
      if (
        typeof item === "object" &&
        item !== null &&
        "path" in item &&
        Array.isArray((item as { path: unknown }).path) &&
        "message" in item &&
        typeof (item as { message: unknown }).message === "string"
      ) {
        const pathArray = (item as { path: unknown[] }).path.map(String);
        validatedErrors.push({
          path: pathArray,
          message: (item as { message: string }).message,
        });
      }
    }

    return validatedErrors;
  } catch {
    // Fail gracefully: AI errors should never break the scan pipeline
    return [];
  }
}
