import * as v from "valibot";
import type { ValidationEngine, ValidationResult, ValidationError } from "../../core/contracts/validation-engine.js";
import { PRESET_RULES, validateField, detectPresets } from "../rules/preset-rules.js";

export class ValibotValidationEngine implements ValidationEngine {
  readonly name = "valibot";

  validate(
    runtimeEnv: Record<string, string>,
    presets?: string[]
  ): ValidationResult {
    const activePresets = presets && presets.length > 0 ? presets : detectPresets(runtimeEnv);
    const shape: Record<string, v.GenericSchema<string | undefined>> = {};
    const presetKeys = new Set<string>();

    activePresets.forEach((preset) => {
      const rules = PRESET_RULES[preset];
      if (!rules) return;

      Object.entries(rules).forEach(([key, rule]) => {
        shape[key] = v.optional(
          v.pipe(
            v.string(),
            v.check(
              (val: string) => validateField(key, val, rule) === null,
              rule.message
            )
          )
        );
        presetKeys.add(key);
      });
    });

    Object.keys(runtimeEnv).forEach((key) => {
      if ((key.endsWith("_URL") || key.endsWith("_URI")) && !presetKeys.has(key)) {
        shape[key] = v.optional(
          v.pipe(
            v.string(),
            v.check(
              (val: string) => /^(https?|postgres(ql)?|mongodb(\+srv)?|rediss?|cloudinary):\/\//.test(val),
              "Field suggests a URL/URI format but lacks a valid protocol prefix."
            )
          )
        );
        presetKeys.add(key);
      }
    });

    const schema = v.object(shape);
    const result = v.safeParse(schema, runtimeEnv);
    const errors: ValidationError[] = [];

    if (!result.success) {
      result.issues.forEach((issue) => {
        const path = issue.path
          ? issue.path.map((p) => ("key" in p && p.key !== undefined ? String(p.key) : String(p)))
          : ["UNKNOWN"];
        errors.push({ path, message: issue.message });
      });
    }

    const unknownKeys = Object.keys(runtimeEnv).filter((k) => !presetKeys.has(k));
    return { errors, unknownKeys };
  }
}

const defaultValibotEngine = new ValibotValidationEngine();

export function runValibotValidation(
  runtimeEnv: Record<string, string>,
  presets?: string[]
): ValidationResult {
  return defaultValibotEngine.validate(runtimeEnv, presets);
}
