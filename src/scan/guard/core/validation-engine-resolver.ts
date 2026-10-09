import type { ValidationEngine } from "../../core/contracts/validation-engine.js";
import type { ValidationEngineResolver } from "../../core/contracts/engine-resolver.js";
import { detectValidationEngine, type ValidationEngineName } from "./engine-detector.js";
import { ZodValidationEngine } from "../engines/zod-engine.js";
import { ValibotValidationEngine } from "../engines/valibot-engine.js";
import { ArkTypeValidationEngine } from "../engines/arktype-engine.js";
import { CustomValidationEngine } from "../engines/custom-engine.js";

export class DefaultValidationEngineResolver implements ValidationEngineResolver {
  constructor(
    private readonly preferredEngine?: ValidationEngineName,
    private readonly projectRoot?: string
  ) {}

  resolve(): ValidationEngine {
    const engineName = this.preferredEngine ?? detectValidationEngine(this.projectRoot);

    switch (engineName) {
      case "zod":
        return new ZodValidationEngine();
      case "valibot":
        return new ValibotValidationEngine();
      case "arktype":
        return new ArkTypeValidationEngine();
      case "custom":
      default:
        return new CustomValidationEngine();
    }
  }
}

export function resolveValidationEngine(
  preferredEngine?: ValidationEngineName,
  projectRoot?: string
): ValidationEngine {
  return new DefaultValidationEngineResolver(preferredEngine, projectRoot).resolve();
}
