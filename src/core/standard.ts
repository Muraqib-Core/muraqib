// src/core/standard.ts
import { z } from "zod";
import type { GuardOptions } from "./types.js";

export function createGuard<T extends z.ZodRawShape>(
  schema: z.ZodObject<T>,
  options: GuardOptions
) {
  // هنا نقوم بدمج المتغيرات مع المخطط (Zod Schema)
  const result = schema.safeParse(options.runtimeEnv);

  if (!result.success) {
    // إلقاء الخطأ بنفس النمط الذي يتوقعه المحرك
    throw {
      message: "Validation Failed",
      errors: result.error.issues,
    };
  }

  return { data: result.data };
}