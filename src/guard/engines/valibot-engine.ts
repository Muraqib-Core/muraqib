/**
 * Valibot Validation Engine
 * Wrapper for Valibot schema validation with structured error reporting
 */
/**
 * NOTE: these are the PUBLIC schema wrappers (exported from src/index.ts).
 * Each wraps a schema supplied by the caller and reports structured issues.
 * They are intentionally separate from src/scan/guard/engines, which build
 * schemas from preset rules and implement the scan-layer ValidationEngine
 * contract. The two sets share no logic, so they are not merged.
 */

import type { BaseSchema, BaseIssue } from 'valibot';
import { safeParse } from 'valibot';

export interface ValidationIssue {
  field: string;
  message: string;
  code: string;
  path: (string | number)[];
}

export interface ValibotValidationResult {
  success: boolean;
  data?: unknown;
  errors: ValidationIssue[];
  raw?: BaseIssue<unknown>;
}

/**
 * Valibot Validation Engine - Unified validation interface for Valibot schemas
 */
export class ValibotEngine {
  private schema: BaseSchema<unknown, unknown, BaseIssue<unknown>>;
  private strict: boolean;

  constructor(schema: BaseSchema<unknown, unknown, BaseIssue<unknown>>, strict = false) {
    if (!schema) {
      throw new Error('Schema is required');
    }
    this.schema = schema;
    this.strict = strict;
  }

  /**
   * Validate data against the schema
   */
  validate(data: unknown): ValibotValidationResult {
    try {
      const result = safeParse(this.schema, data);

      if (result.success) {
        return {
          success: true,
          data: result.output,
          errors: [],
        };
      }

      const issues = this.parseValibotIssues(result.issues);
      return {
        success: false,
        errors: issues,
        raw: result.issues[0],
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
  validatePartial(data: unknown): ValibotValidationResult {
    try {
      if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
        const result = this.validate(data);
        if (result.success) {
          return result;
        }
        return {
          success: false,
          errors: result.errors,
          raw: result.raw,
        };
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
  transform(fn: (data: unknown) => unknown): ValibotEngine {
    const transformed = {
      ...this.schema,
      _transform: fn,
    } as BaseSchema<unknown, unknown, BaseIssue<unknown>>;
    return new ValibotEngine(transformed, this.strict);
  }

  /**
   * Make schema optional
   */
  optional(): ValibotEngine {
    const optional = {
      ...this.schema,
      _optional: true,
    } as BaseSchema<unknown, unknown, BaseIssue<unknown>>;
    return new ValibotEngine(optional, this.strict);
  }

  /**
   * Make schema nullable
   */
  nullable(): ValibotEngine {
    const nullable = {
      ...this.schema,
      _nullable: true,
    } as BaseSchema<unknown, unknown, BaseIssue<unknown>>;
    return new ValibotEngine(nullable, this.strict);
  }

  /**
   * Parse and transform Valibot issues into unified format
   */
  private parseValibotIssues(issues: BaseIssue<unknown>[]): ValidationIssue[] {
    return issues.map(issue => ({
      field: this.getFieldPath(issue),
      message: issue.message || 'Validation error',
      code: (issue as any).type || 'VALIDATION_ERROR',
      path: this.extractPath(issue),
    }));
  }

  /**
   * Extract field path from issue
   */
  private getFieldPath(issue: BaseIssue<unknown>): string {
    const path = this.extractPath(issue);
    return path.length > 0 ? path.join('.') : 'root';
  }

  /**
   * Extract path array from issue
   */
  private extractPath(issue: BaseIssue<unknown>): (string | number)[] {
    const pathArray: (string | number)[] = [];
    let current: any = issue;

    while (current) {
      if (current.key) {
        pathArray.unshift(current.key);
      } else if (current.index !== undefined) {
        pathArray.unshift(current.index);
      }
      current = (current as any).input;
    }

    return pathArray;
  }

  /**
   * Get raw Valibot schema
   */
  getSchema(): BaseSchema<unknown, unknown, BaseIssue<unknown>> {
    return this.schema;
  }
}

/**
 * Create a Valibot validation engine from a schema
 */
export function createValibotEngine(
  schema: BaseSchema<unknown, unknown, BaseIssue<unknown>>,
  strict = false
): ValibotEngine {
  return new ValibotEngine(schema, strict);
}

/**
 * Batch validate multiple data items
 */
export function batchValidateValibot(
  schema: BaseSchema<unknown, unknown, BaseIssue<unknown>>,
  items: unknown[]
): Array<{ item: unknown; valid: boolean; errors: ValidationIssue[] }> {
  const engine = new ValibotEngine(schema);
  return items.map(item => {
    const result = engine.validate(item);
    return {
      item,
      valid: result.success,
      errors: result.errors,
    };
  });
}
