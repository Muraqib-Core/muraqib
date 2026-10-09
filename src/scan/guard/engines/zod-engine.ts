import { z, type ZodTypeAny } from "zod";
import type { ValidationEngine, ValidationResult, ValidationError } from "../../core/contracts/validation-engine.js";
import { PRESET_RULES, validateField, detectPresets } from "../rules/preset-rules.js";

export class ZodValidationEngine implements ValidationEngine {
  readonly name = "zod";

  validate(
    runtimeEnv: Record<string, string>,
    presets?: string[]
  ): ValidationResult {
    const activePresets = presets && presets.length > 0 ? presets : detectPresets(runtimeEnv);
    const shape: Record<string, ZodTypeAny> = {};
    const presetKeys = new Set<string>();

    activePresets.forEach((preset) => {
      const rules = PRESET_RULES[preset];
      if (!rules) return;

      Object.entries(rules).forEach(([key, rule]) => {
        shape[key] = z
          .string()
          .refine((val) => validateField(key, val, rule) === null, {
            message: rule.message,
          })
          .optional();

        presetKeys.add(key);
      });
    });

    Object.keys(runtimeEnv).forEach((key) => {
      if ((key.endsWith("_URL") || key.endsWith("_URI")) && !presetKeys.has(key)) {
        shape[key] = z
          .string()
          .refine(
            (val) => /^(https?|postgres(ql)?|mongodb(\+srv)?|rediss?|cloudinary):\/\//.test(val),
            { message: "Field suggests a URL/URI format but lacks a valid protocol prefix." }
          )
          .optional();
        presetKeys.add(key);
      }
    });

    const schema = z.object(shape);
    const result = schema.safeParse(runtimeEnv);
    const errors: ValidationError[] = [];

    if (!result.success) {
      result.error.issues.forEach((err) => {
        errors.push({
          path: err.path.map(String),
          message: err.message,
        });
      });
    }

    const unknownKeys = Object.keys(runtimeEnv).filter((k) => !presetKeys.has(k));
    return { errors, unknownKeys };
  }
}

const defaultZodEngine = new ZodValidationEngine();

export function runZodValidation(
  runtimeEnv: Record<string, string>,
  presets?: string[]
): ValidationResult {
  return defaultZodEngine.validate(runtimeEnv, presets);
}
