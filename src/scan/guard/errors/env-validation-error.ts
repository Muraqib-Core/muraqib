import type { ValidationError } from "../../core/contracts/validation-engine.js";

export class EnvValidationError extends Error {
  constructor(
    message: string,
    public readonly errors: ValidationError[],
    public readonly unknownKeys: string[],
    public readonly engine: string,
  ) {
    super(message);
    this.name = "EnvValidationError";
  }
}
