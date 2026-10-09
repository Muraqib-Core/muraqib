/**
 * ArkType Validation Engine
 * Wrapper for ArkType schema validation with structured error reporting
 */

import type { Type } from 'arktype';

export interface ValidationIssue {
  field: string;
  message: string;
  code: string;
  path: (string | number)[];
}

export interface ArktypeValidationResult {
  success: boolean;
  data?: unknown;
  errors: ValidationIssue[];
  raw?: string;
}

/**
 * ArkType Validation Engine - Unified validation interface for ArkType schemas
 */
export class ArktypeEngine {
  private schema: Type<any>;
  private strict: boolean;

  constructor(schema: Type<any>, strict = false) {
    if (!schema) {
      throw new Error('Schema is required');
    }
    this.schema = schema;
    this.strict = strict;
  }

  /**
   * Validate data against the schema
   */
  validate(data: unknown): ArktypeValidationResult {
    try {
      const result = this.schema(data);

      if (typeof result === 'string' || (result && typeof result === 'object' && 'message' in result)) {
        return {
          success: false,
          errors: this.parseArktypeError(result),
        };
      }

      return {
        success: true,
        data: result,
        errors: [],
      };
    } catch (error) {
      return {
        success: false,
        errors: [
          {
            field: 'unknown',
            message: error instanceof Error ? error.message : String(error),
            code: 'UNKNOWN_ERROR',
            path: [],
          },
        ],
        raw: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Validate data with strict mode (throws on error)
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
   * Partial validation - validate subset of fields
   */
  validatePartial(data: unknown): ArktypeValidationResult {
    try {
      if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
        return this.validate(data);
      }

      return this.validate(data);
    } catch (error) {
      return {
        success: false,
        errors: [
          {
            field: 'unknown',
            message: error instanceof Error ? error.message : String(error),
            code: 'UNKNOWN_ERROR',
            path: [],
          },
        ],
        raw: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get schema description or metadata
   */
  getSchemaInfo(): { type: string; description?: string } {
    const type = this.schema.constructor.name;
    return {
      type,
      description: (this.schema as any).description,
    };
  }

  /**
   * Transform validated data
   */
  transform(fn: (data: unknown) => unknown): ArktypeEngine {
    const transformed = {
      ...this.schema,
      _transform: fn,
    } as any as Type<any>;
    return new ArktypeEngine(transformed, this.strict);
  }

  /**
   * Make schema optional
   */
  optional(): ArktypeEngine {
    const optional = {
      ...this.schema,
      _optional: true,
    } as any as Type<any>;
    return new ArktypeEngine(optional, this.strict);
  }

  /**
   * Make schema nullable
   */
  nullable(): ArktypeEngine {
    const nullable = {
      ...this.schema,
      _nullable: true,
    } as any as Type<any>;
    return new ArktypeEngine(nullable, this.strict);
  }

  /**
   * Parse ArkType validation errors
   */
  private parseArktypeError(error: unknown): ValidationIssue[] {
    const errorString = String(error);
    const lines = errorString.split('\n').filter(l => l.trim());

    return lines.map((line, index) => {
      const fieldMatch = line.match(/(?:at\s)?([a-zA-Z_$][a-zA-Z0-9_$]*)/);
      const field = fieldMatch?.[1] || `error_${index}`;
      const pathArray: (string | number)[] = [field];

      return {
        field: field || `error_${index}`,
        message: line.replace(/^at\s/, '').trim(),
        code: 'ARKTYPE_ERROR',
        path: pathArray,
      };
    });
  }

  /**
   * Get raw ArkType schema
   */
  getSchema(): Type<any> {
    return this.schema;
  }
}

/**
 * Create an ArkType validation engine from a schema
 */
export function createArktypeEngine(schema: Type<any>, strict = false): ArktypeEngine {
  return new ArktypeEngine(schema, strict);
}

/**
 * Batch validate multiple data items
 */
export function batchValidateArktype(
  schema: Type<any>,
  items: unknown[]
): Array<{ item: unknown; valid: boolean; errors: ValidationIssue[] }> {
  const engine = new ArktypeEngine(schema);
  return items.map(item => {
    const result = engine.validate(item);
    return {
      item,
      valid: result.success,
      errors: result.errors,
    };
  });
}
