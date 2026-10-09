/**
 * Custom Validation Engine
 * Flexible validation engine supporting user-defined validation logic
 */

export interface ValidationIssue {
  field: string;
  message: string;
  code: string;
  path: (string | number)[];
}

export interface CustomValidationResult {
  success: boolean;
  data?: unknown;
  errors: ValidationIssue[];
}

export type ValidationFn = (data: unknown) => ValidationIssue[] | null | undefined;
export type TransformFn = (data: unknown) => unknown;
export type CustomSchema = {
  validate: ValidationFn;
  transform?: TransformFn;
  isOptional?: boolean;
  isNullable?: boolean;
};

/**
 * Custom Validation Engine - Flexible validation for user-defined schemas
 */
export class CustomEngine {
  private validators: ValidationFn[] = [];
  private transforms: TransformFn[] = [];
  private isOptional: boolean = false;
  private isNullable: boolean = false;

  constructor(validators?: ValidationFn | ValidationFn[]) {
    if (validators) {
      this.validators = Array.isArray(validators) ? validators : [validators];
    }
  }

  /**
   * Add a validation function
   */
  addValidator(fn: ValidationFn): CustomEngine {
    this.validators.push(fn);
    return this;
  }

  /**
   * Add a transform function
   */
  addTransform(fn: TransformFn): CustomEngine {
    this.transforms.push(fn);
    return this;
  }

  /**
   * Set optional flag
   */
  setOptional(optional: boolean = true): CustomEngine {
    this.isOptional = optional;
    return this;
  }

  /**
   * Set nullable flag
   */
  setNullable(nullable: boolean = true): CustomEngine {
    this.isNullable = nullable;
    return this;
  }

  /**
   * Validate data against all validators
   */
  validate(data: unknown): CustomValidationResult {
    try {
      if (data === undefined && this.isOptional) {
        return {
          success: true,
          data: undefined,
          errors: [],
        };
      }

      if (data === null && this.isNullable) {
        return {
          success: true,
          data: null,
          errors: [],
        };
      }

      if ((data === undefined || data === null) && !this.isOptional && !this.isNullable) {
        return {
          success: false,
          errors: [
            {
              field: 'root',
              message: `Value is ${data === undefined ? 'undefined' : 'null'} but schema does not allow it`,
              code: 'NULL_VALIDATION_ERROR',
              path: [],
            },
          ],
        };
      }

      const errors = this.runValidators(data);

      if (errors.length > 0) {
        return {
          success: false,
          errors,
        };
      }

      const transformed = this.runTransforms(data);

      return {
        success: true,
        data: transformed,
        errors: [],
      };
    } catch (error) {
      return {
        success: false,
        errors: [
          {
            field: 'unknown',
            message: error instanceof Error ? error.message : String(error),
            code: 'VALIDATION_ERROR',
            path: [],
          },
        ],
      };
    }
  }

  /**
   * Validate with strict mode (throws on error)
   */
  validateStrict(data: unknown): unknown {
    const result = this.validate(data);
    if (!result.success) {
      const messages = result.errors.map(e => `${e.field}: ${e.message}`).join('; ');
      throw new Error(`Validation failed: ${messages}`);
    }
    return result.data;
  }

  /**
   * Partial validation
   */
  validatePartial(data: unknown): CustomValidationResult {
    return this.validate(data);
  }

  /**
   * Get schema metadata
   */
  getSchemaInfo(): { type: string; description?: string } {
    return {
      type: 'CustomSchema',
      description: `Custom validation with ${this.validators.length} validator(s) and ${this.transforms.length} transform(s)`,
    };
  }

  /**
   * Create a new engine with a transform function
   */
  transform(fn: TransformFn): CustomEngine {
    const engine = new CustomEngine(this.validators);
    engine.transforms = [...this.transforms, fn];
    engine.isOptional = this.isOptional;
    engine.isNullable = this.isNullable;
    return engine;
  }

  /**
   * Create a new engine with optional flag
   */
  optional(): CustomEngine {
    const engine = new CustomEngine(this.validators);
    engine.transforms = [...this.transforms];
    engine.isOptional = true;
    engine.isNullable = this.isNullable;
    return engine;
  }

  /**
   * Create a new engine with nullable flag
   */
  nullable(): CustomEngine {
    const engine = new CustomEngine(this.validators);
    engine.transforms = [...this.transforms];
    engine.isOptional = this.isOptional;
    engine.isNullable = true;
    return engine;
  }

  /**
   * Run all validators
   */
  private runValidators(data: unknown): ValidationIssue[] {
    const allErrors: ValidationIssue[] = [];

    for (const validator of this.validators) {
      const errors = validator(data);
      if (errors && Array.isArray(errors)) {
        allErrors.push(...errors);
      }
    }

    return allErrors;
  }

  /**
   * Run all transforms in sequence
   */
  private runTransforms(data: unknown): unknown {
    let result = data;

    for (const transform of this.transforms) {
      result = transform(result);
    }

    return result;
  }

  /**
   * Get validator count
   */
  getValidatorCount(): number {
    return this.validators.length;
  }

  /**
   * Get transform count
   */
  getTransformCount(): number {
    return this.transforms.length;
  }
}

/**
 * Create a custom validation engine
 */
export function createCustomEngine(validators?: ValidationFn | ValidationFn[]): CustomEngine {
  return new CustomEngine(validators);
}

/**
 * Batch validate with custom engine
 */
export function batchValidateCustom(
  engine: CustomEngine,
  items: unknown[]
): Array<{ item: unknown; valid: boolean; errors: ValidationIssue[] }> {
  return items.map(item => {
    const result = engine.validate(item);
    return {
      item,
      valid: result.success,
      errors: result.errors,
    };
  });
}

/**
 * Common validators for reuse
 */
export const commonValidators = {
  /**
   * Validate that data is a string
   */
  isString: (data: unknown): ValidationIssue[] | null => {
    if (typeof data !== 'string') {
      return [
        {
          field: 'root',
          message: `Expected string, got ${typeof data}`,
          code: 'TYPE_ERROR',
          path: [],
        },
      ];
    }
    return null;
  },

  /**
   * Validate that data is a number
   */
  isNumber: (data: unknown): ValidationIssue[] | null => {
    if (typeof data !== 'number' || isNaN(data)) {
      return [
        {
          field: 'root',
          message: `Expected number, got ${typeof data}`,
          code: 'TYPE_ERROR',
          path: [],
        },
      ];
    }
    return null;
  },

  /**
   * Validate string length
   */
  stringLength: (min: number, max: number) => (data: unknown): ValidationIssue[] | null => {
    if (typeof data !== 'string') return null;
    if (data.length < min || data.length > max) {
      return [
        {
          field: 'root',
          message: `String length must be between ${min} and ${max}, got ${data.length}`,
          code: 'LENGTH_ERROR',
          path: [],
        },
      ];
    }
    return null;
  },

  /**
   * Validate number range
   */
  numberRange: (min: number, max: number) => (data: unknown): ValidationIssue[] | null => {
    if (typeof data !== 'number') return null;
    if (data < min || data > max) {
      return [
        {
          field: 'root',
          message: `Number must be between ${min} and ${max}, got ${data}`,
          code: 'RANGE_ERROR',
          path: [],
        },
      ];
    }
    return null;
  },

  /**
   * Validate email format
   */
  isEmail: (data: unknown): ValidationIssue[] | null => {
    if (typeof data !== 'string') return null;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(data)) {
      return [
        {
          field: 'root',
          message: `Invalid email format: ${data}`,
          code: 'EMAIL_ERROR',
          path: [],
        },
      ];
    }
    return null;
  },

  /**
   * Validate array
   */
  isArray: (data: unknown): ValidationIssue[] | null => {
    if (!Array.isArray(data)) {
      return [
        {
          field: 'root',
          message: `Expected array, got ${typeof data}`,
          code: 'TYPE_ERROR',
          path: [],
        },
      ];
    }
    return null;
  },

  /**
   * Validate array length
   */
  arrayLength: (min: number, max: number) => (data: unknown): ValidationIssue[] | null => {
    if (!Array.isArray(data)) return null;
    if (data.length < min || data.length > max) {
      return [
        {
          field: 'root',
          message: `Array length must be between ${min} and ${max}, got ${data.length}`,
          code: 'LENGTH_ERROR',
          path: [],
        },
      ];
    }
    return null;
  },

  /**
   * Validate object
   */
  isObject: (data: unknown): ValidationIssue[] | null => {
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
      return [
        {
          field: 'root',
          message: `Expected object, got ${typeof data}`,
          code: 'TYPE_ERROR',
          path: [],
        },
      ];
    }
    return null;
  },

  /**
   * Validate required properties
   */
  requiredProps: (props: string[]) => (data: unknown): ValidationIssue[] | null => {
    if (typeof data !== 'object' || data === null) return null;
    const obj = data as Record<string, unknown>;
    const errors: ValidationIssue[] = [];

    for (const prop of props) {
      if (!(prop in obj)) {
        errors.push({
          field: prop,
          message: `Required property '${prop}' is missing`,
          code: 'REQUIRED_ERROR',
          path: [prop],
        });
      }
    }

    return errors.length > 0 ? errors : null;
  },
};
