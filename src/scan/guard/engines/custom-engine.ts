// NOTE: scan-layer ValidationEngine implementations. They build the schema
// themselves from preset rules and validate the runtime env. They are distinct
// from the public caller-schema wrappers in src/guard/engines (not duplicates).
import type { ValidationEngine, ValidationResult, ValidationError } from "../../core/contracts/validation-engine.js";
import { PRESET_RULES, validateField, detectPresets, URL_SCHEME_PATTERN } from "../rules/preset-rules.js";

/**
 * Custom validation engine class.
 */
export class CustomValidationEngine implements ValidationEngine {
  readonly name = "custom";

  /**
   * Validate.
   *
   * @param runtimeEnv - Runtime env
   * @param presets - Presets
   * @returns Validate result
   */
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

        if (!URL_SCHEME_PATTERN.test(value)) {
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

/**
 * Run custom validation.
 *
 * @param runtimeEnv - Runtime env
 * @param presets - Presets
 * @returns Run custom validation result
 */
export function runCustomValidation(
  runtimeEnv: Record<string, string>,
  presets?: string[]
): ValidationResult {
  return defaultEngine.validate(runtimeEnv, presets);
}
