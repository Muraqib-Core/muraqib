import type { ValidationEngine, ValidationResult, ValidationError } from "../../core/contracts/validation-engine.js";
import { PRESET_RULES, validateField, detectPresets } from "../rules/preset-rules.js";

export class CustomValidationEngine implements ValidationEngine {
  readonly name = "custom";

  validate(
    runtimeEnv: Record<string, string>,
    presets?: string[]
  ): ValidationResult {
    const activePresets = presets && presets.length > 0 ? presets : detectPresets(runtimeEnv);
    const errors: ValidationError[] = [];
    const checkedKeys = new Set<string>();

    activePresets.forEach((preset) => {
      const rules = PRESET_RULES[preset];
      if (!rules) return;

      Object.entries(rules).forEach(([key, rule]) => {
        checkedKeys.add(key);
        const value = runtimeEnv[key];
        if (value === undefined || value === "") return;

        const errorMessage = validateField(key, value, rule);
        if (errorMessage) {
          errors.push({ path: [key], message: errorMessage });
        }
      });
    });

    Object.keys(runtimeEnv).forEach((key) => {
      if ((key.endsWith("_URL") || key.endsWith("_URI")) && !checkedKeys.has(key)) {
        checkedKeys.add(key);
        const value = runtimeEnv[key];
        if (value === undefined || value === "") return;

        if (!/^(https?|postgres(ql)?|mongodb(\+srv)?|rediss?|cloudinary):\/\//.test(value)) {
          errors.push({
            path: [key],
            message: "Field suggests a URL/URI format but lacks a valid protocol prefix.",
          });
        }
      }
    });

    const unknownKeys = Object.keys(runtimeEnv).filter((k) => !checkedKeys.has(k));
    return { errors, unknownKeys };
  }
}

const defaultEngine = new CustomValidationEngine();

export function runCustomValidation(
  runtimeEnv: Record<string, string>,
  presets?: string[]
): ValidationResult {
  return defaultEngine.validate(runtimeEnv, presets);
}
