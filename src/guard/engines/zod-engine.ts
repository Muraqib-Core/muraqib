/**
 * Zod Validation Engine
 * Wrapper for Zod schema validation with structured error reporting
 *
 * NOTE: these are the PUBLIC schema wrappers (exported from src/index.ts).
 * Each wraps a schema supplied by the caller and reports structured issues.
 * They are intentionally separate from src/scan/guard/engines, which build
 * schemas from preset rules and implement the scan-layer ValidationEngine
 * contract. The two sets share no logic, so they are not merged.
 */

import { z, ZodError } from "zod";
import type { ZodSchema } from "zod";

/** Minimal shape of a Zod issue that this engine reads. */
interface ZodIssueLike {
  path?: ReadonlyArray<string | number | symbol>;
  message: string;
  code: string;
}

import type { ValidationIssue } from "./validation-issue.js";
import { dataOrThrow, unknownErrorIssue } from "./validation-issue.js";

export type { ValidationIssue };

export interface ZodValidationResult {
  success: boolean;
  data?: unknown;
  errors: ValidationIssue[];
  raw?: ZodError;
}

/**
 * Zod Validation Engine - Unified validation interface for Zod schemas
 */
export class ZodEngine {
  private schema: ZodSchema;
  private strict: boolean;

  constructor(schema: ZodSchema, strict = false) {
    if (!schema) {
      throw new Error("Schema is required");
    }
    this.schema = schema;
    this.strict = strict;
  }

  /**
   * Validate data against the schema
   */
  validate(data: unknown): ZodValidationResult {
    try {
      const result = this.schema.parse(data);
      return {
        success: true,
        data: result,
        errors: [],
      };
    } catch (error) {
      return this.failureFrom(error);
    }
  }

  /** Converts a thrown value into a failed result (Zod issues when it is a ZodError). */
  private failureFrom(error: unknown): ZodValidationResult {
    if (error instanceof ZodError) {
      return { success: false, errors: this.parseZodError(error), raw: error };
    }
    return { success: false, errors: [unknownErrorIssue(error)] };
  }

  /**
   * Validate data with strict mode (throws on error)
   */
  validateStrict(data: unknown): unknown {
    return dataOrThrow(this.validate(data));
  }

  /**
   * Partial validation - only validate provided fields
   */
  validatePartial(data: unknown): ZodValidationResult {
    try {
      if (this.schema instanceof z.ZodObject) {
        const partial = this.schema.partial();
        const result = partial.parse(data);
        return {
          success: true,
          data: result,
          errors: [],
        };
      }

      return this.validate(data);
    } catch (error) {
      return this.failureFrom(error);
    }
  }

  /**
   * Get schema description or metadata
   */
  getSchemaInfo(): { type: string; description?: string | undefined } {
    const type = this.schema.constructor.name;
    return {
      type,
      description: this.schema.description,
    };
  }

  /**
   * Refine schema with additional validation
   */
  refine(fn: (data: unknown) => boolean, message: string): ZodEngine {
    const refined = this.schema.refine(fn, { message });
    return new ZodEngine(refined, this.strict);
  }

  /**
   * Transform validated data
   */
  transform(fn: (data: unknown) => unknown): ZodEngine {
    const transformed = this.schema.transform(fn);
    return new ZodEngine(transformed, this.strict);
  }

  /**
   * Merge with another schema
   */
  merge(other: ZodSchema): ZodEngine {
    if (this.schema instanceof z.ZodObject && other instanceof z.ZodObject) {
      const merged = (this.schema).merge(other);
      return new ZodEngine(merged, this.strict);
    }
    throw new Error("Can only merge ZodObject schemas");
  }

  /**
   * Make schema optional
   */
  optional(): ZodEngine {
    const optional = this.schema.optional();
    return new ZodEngine(optional, this.strict);
  }

  /**
   * Make schema nullable
   */
  nullable(): ZodEngine {
    const nullable = this.schema.nullable();
    return new ZodEngine(nullable, this.strict);
  }

  /**
   * Parse and transform Zod errors into unified format
   */
  private parseZodError(error: ZodError): ValidationIssue[] {
    const issues: ReadonlyArray<ZodIssueLike> = error.issues ?? [];
    return issues.map((err) => ({
      field: (err.path ?? []).map(String).join(".") || "root",
      message: err.message,
      code: err.code,
      path: (err.path ?? []).filter((k): k is string | number => typeof k !== "symbol"),
    }));
  }

  /**
   * Get raw Zod schema
   */
  getSchema(): ZodSchema {
    return this.schema;
  }
}

/**
 * Create a Zod validation engine from a schema
 */
export function createZodEngine(schema: ZodSchema, strict = false): ZodEngine {
  return new ZodEngine(schema, strict);
}

/**
 * Batch validate multiple data items
 */
export function batchValidateZod(
  schema: ZodSchema,
  items: unknown[]
): Array<{ item: unknown; valid: boolean; errors: ValidationIssue[] }> {
  const engine = new ZodEngine(schema);
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
 * Validate with schema composition
 */
export function composeZodSchemas(...schemas: ZodSchema[]): ZodEngine {
  if (schemas.length === 0) {
    throw new Error("At least one schema is required");
  }

  let composed = schemas[0] as ZodSchema;
  for (let i = 1; i < schemas.length; i++) {
    const schema = schemas[i];
    if (schema && composed instanceof z.ZodObject && schema instanceof z.ZodObject) {
      composed = (composed).merge(schema);
    }
  }

  return new ZodEngine(composed);
}
