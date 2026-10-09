import { type } from "arktype";
import type { ValidationEngine, ValidationResult, ValidationError } from "../../core/contracts/validation-engine.js";
import { PRESET_RULES, validateField, detectPresets } from "../rules/preset-rules.js";

export class ArkTypeValidationEngine implements ValidationEngine {
  readonly name = "arktype";

  validate(
    runtimeEnv: Record<string, string>,
    presets?: string[]
  ): ValidationResult {
    const activePresets = presets && presets.length > 0 ? presets : detectPresets(runtimeEnv);
    const shape: Record<string, string> = {};
    const presetKeys = new Set<string>();

    activePresets.forEach((preset) => {
      const rules = PRESET_RULES[preset];
      if (!rules) return;

      Object.entries(rules).forEach(([key]) => {
        shape[`${key}?`] = "string";
        presetKeys.add(key);
      });
    });

    Object.keys(runtimeEnv).forEach((key) => {
      if ((key.endsWith("_URL") || key.endsWith("_URI")) && !presetKeys.has(key)) {
        shape[`${key}?`] = "string";
        presetKeys.add(key);
      }
    });

    const schema = type(shape);
    const errors: ValidationError[] = [];
    const result = schema(runtimeEnv);

    if (result instanceof type.errors) {
      result.forEach((err) => {
        const field = String(err.path[0]);
        errors.push({
          path: [field],
          message: err.message,
        });
      });
    }

    // Semantic validation via canonical rules
    activePresets.forEach((preset) => {
      const rules = PRESET_RULES[preset];
      if (!rules) return;

      Object.entries(rules).forEach(([key, rule]) => {
        const value = runtimeEnv[key];
        if (value === undefined || value === "") return;
        if (errors.some((e) => e.path[0] === key)) return;

        const errorMessage = validateField(key, value, rule);
        if (errorMessage) {
          errors.push({ path: [key], message: errorMessage });
        }
      });
    });

    Object.keys(runtimeEnv).forEach((key) => {
      if ((key.endsWith("_URL") || key.endsWith("_URI")) && presetKeys.has(key)) {
        const value = runtimeEnv[key];
        if (value === undefined || value === "") return;
        if (errors.some((e) => e.path[0] === key)) return;

        if (!/^(https?|postgres(ql)?|mongodb(\+srv)?|rediss?|cloudinary):\/\//.test(value)) {
          errors.push({
            path: [key],
            message: "Field suggests a URL/URI format but lacks a valid protocol prefix.",
          });
        }
      }
    });

    const unknownKeys = Object.keys(runtimeEnv).filter((k) => !presetKeys.has(k));
    return { errors, unknownKeys };
  }
}

const defaultArktypeEngine = new ArkTypeValidationEngine();

export function runArktypeValidation(
  runtimeEnv: Record<string, string>,
  presets?: string[]
): ValidationResult {
  return defaultArktypeEngine.validate(runtimeEnv, presets);
}
