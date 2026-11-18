// src/core/standard.ts
import { z } from "zod";
import type { GuardOptions } from "./types.js";

/**
 * Error thrown by {@link createGuard} when the runtime env fails schema validation.
 * `message` is always "Validation Failed"; `errors` carries the zod issues.
 */
export class GuardValidationError extends Error {
  readonly errors: z.ZodIssue[];

  constructor(errors: z.ZodIssue[]) {
    super("Validation Failed");
    this.name = "GuardValidationError";
    this.errors = errors;
  }
}

/**
 * Create guard.
 *
 * @param schema - Schema
 * @param options - Options
 * @returns Create guard result
 */
export function createGuard<T extends z.ZodRawShape>(
  schema: z.ZodObject<T>,
  options: GuardOptions
): { data: z.infer<z.ZodObject<T>> } {
  // هنا نقوم بدمج المتغيرات مع المخطط (Zod Schema)
  const result = schema.safeParse(options.runtimeEnv);

  if (!result.success) {
    // إلقاء الخطأ بنفس النمط الذي يتوقعه المحرك
    throw new GuardValidationError(result.error.issues);
  }

  return { data: result.data };
}