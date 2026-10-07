import { z } from "zod";

export const cachePerformanceSchema = {
  STATIC_ASSETS_CACHE_MAX_AGE: z
    .string()
    .or(z.number())
    .transform((val) => Number(val))
    .refine((val) => !isNaN(val) && val >= 86400, {
      message: "❌ [Muraqib Performance Guard]: Cache max-age must be at least 1 day (86400 seconds).",
    }),
  ENABLE_SERVER_COMPRESSION: z
    .string()
    .or(z.boolean())
    .transform((val) => String(val).toLowerCase() === "true")
    .refine((val) => val === true, {
      message: "⚠️ [Muraqib Performance Warning]: Gzip/Brotli Compression is disabled.",
    }),
};
