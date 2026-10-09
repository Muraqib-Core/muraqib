export interface ValidationError {
  path: string[];
  message: string;
}

export interface ValidationResult {
  errors: ValidationError[];
  unknownKeys: string[];
}

export interface ValidationEngine {
  readonly name: string;

  validate(
    env: Record<string, string>,
    presets: string[]
  ): ValidationResult;
}
