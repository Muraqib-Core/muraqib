import { resolveValidationEngine } from "./core/validation-engine-resolver.js";
import { detectPresets } from "./rules/preset-rules.js";
import { EnvValidationError } from "./errors/env-validation-error.js";
import type { GuardOptions } from "../types/interface.js";

export async function createEnv(opts: GuardOptions) {
  const processedEnv = { ...(opts.runtimeEnvStrict ?? opts.runtimeEnv ?? {}) };

  // Sanitize empty strings
  if (opts.emptyStringAsUndefined ?? true) {
    for (const key in processedEnv) {
      if (processedEnv[key] === "") {
        delete processedEnv[key];
      }
    }
  }

  // Detect presets
  const activePresets = opts.extends ?? detectPresets(processedEnv);

  // Resolve validation engine
  const engine = resolveValidationEngine(opts.engine, opts.projectRoot);

  // Execute validation
  const result = engine.validate(processedEnv, activePresets);

  // Raise typed domain errors if validation fails
  if (result.errors.length > 0) {
    throw new EnvValidationError(
      "Muraqib Semantic Validation Failed",
      result.errors,
      result.unknownKeys,
      engine.name
    );
  }

  return { env: processedEnv, unknownKeys: result.unknownKeys, engine: engine.name };
}
