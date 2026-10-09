import { z } from "zod";
import { createGuard } from "../core/standard.js";
import type { GuardSchema } from "../core/types.js";
import { isWithinSchedule } from "../utils/schedule-validator.js";
import { loadEnv } from "./loaders.js";
import type { CreateEnvOptions } from "./options.js";
import type { InferSchema, IntersectExtension } from "./types.js";

const SKIP_ENV_VALIDATION = process.env.SKIP_ENV_VALIDATION === "true" || process.env.SKIP_ENV_VALIDATION === "1";

export function createEnv<
  TPrefix extends string = "",
  TServer extends GuardSchema = Record<string, never>,
  TClient extends GuardSchema = Record<string, never>,
  TExtends extends unknown[] = []
>(
  opts: CreateEnvOptions<TPrefix, TServer, TClient, TExtends>
): (InferSchema<TServer> & InferSchema<TClient> & IntersectExtension<TExtends>) | null {

  if (opts.envFilePath) {
    const files = Array.isArray(opts.envFilePath) ? opts.envFilePath : [opts.envFilePath];
    loadEnv({ files, preserveProcessEnv: opts.preserveProcessEnv ?? false, verbose: !opts.silent });
  }

  if (opts.schedule) {
    const allowedToRun = isWithinSchedule(opts.schedule);
    if (!allowedToRun) {
      if (!opts.silent) {
        console.warn(`⏳ [Muraqib Scheduler]: Process halted automatically. Current time is outside allowed cron window.`);
      }
      return null;
    }
  }

  if (opts.skipValidation ?? SKIP_ENV_VALIDATION) {
    if (!opts.silent) {
      console.log(`⏭️ [Muraqib Guards]: Validation skipped (skipValidation=true).`);
    }
    return process.env as unknown as InferSchema<TServer> & InferSchema<TClient> & IntersectExtension<TExtends>;
  }

  const rawSchemaFields: Record<string, z.ZodTypeAny> = {
    ...(opts.server as Record<string, z.ZodTypeAny>),
    ...(opts.client as Record<string, z.ZodTypeAny>),
  };

  const combinedSchema = z.object(rawSchemaFields);
  const rawEnv = opts.runtimeEnvStrict ?? opts.runtimeEnv ?? process.env;
  const processedEnv: Record<string, string | undefined> = { ...rawEnv } as Record<string, string | undefined>;

  if (opts.extends && Array.isArray(opts.extends)) {
    for (const extendedEnv of opts.extends) {
      if (extendedEnv && typeof extendedEnv === "object") {
        Object.assign(processedEnv, extendedEnv);
      }
    }
  }

  const shouldSanitize = opts.emptyStringAsUndefined ?? true;
  if (shouldSanitize) {
    for (const key in processedEnv) {
      if (processedEnv[key] === "") {
        processedEnv[key] = undefined;
      }
    }
  }

  if (!opts.silent) {
    console.log(`🛡️ [Muraqib Guards]: Building and executing runtime environment integrity validations...`);
  }

  const validationResult = combinedSchema.safeParse(processedEnv);

  if (!validationResult.success) {
    const issues = validationResult.error.issues.map((e) => ({
      path: e.path.join("."),
      message: e.message,
    }));

    const formattedMessage = opts.formatError
      ? opts.formatError(issues)
      : `💥 [Muraqib Guards Error]: Environment core validation crashed with ${issues.length} violation(s)!\n\n` +
        issues.map((i) => `  • ${i.path}: ${i.message}`).join("\n");

    if (!opts.silent) {
      console.error(formattedMessage);
    }

    const error = new Error(formattedMessage);
    (error as Error & { isMuraqibCustom: boolean; errors: { path: string; message: string }[] }).isMuraqibCustom = true;
    (error as Error & { errors: { path: string; message: string }[] }).errors = issues;
    throw error;
  }

  const validatedGuard = createGuard(combinedSchema, {
    runtimeEnv: processedEnv,
    isServer: opts.isServer ?? typeof window === "undefined",
    emptyStringAsUndefined: shouldSanitize,
  });

  return (validatedGuard?.data ?? validatedGuard) as unknown as InferSchema<TServer> & InferSchema<TClient> & IntersectExtension<TExtends>;
}

export function safeCreateEnv<
  TPrefix extends string = "",
  TServer extends GuardSchema = Record<string, never>,
  TClient extends GuardSchema = Record<string, never>,
  TExtends extends unknown[] = []
>(
  opts: CreateEnvOptions<TPrefix, TServer, TClient, TExtends>
): {
  success: true;
  data: InferSchema<TServer> & InferSchema<TClient> & IntersectExtension<TExtends>;
} | {
  success: false;
  error: { path: string; message: string }[];
} {
  try {
    const data = createEnv(opts);
    if (data === null) {
      return { success: false, error: [{ path: "schedule", message: "Outside allowed schedule window." }] };
    }
    return { success: true, data: data as InferSchema<TServer> & InferSchema<TClient> & IntersectExtension<TExtends> };
  } catch (e: unknown) {
    type MuraqibError = Error & { isMuraqibCustom?: boolean; errors?: { path: string; message: string }[] };
    const me = e as MuraqibError;
    if (me.isMuraqibCustom && Array.isArray(me.errors)) {
      return { success: false, error: me.errors };
    }
    return { success: false, error: [{ path: "unknown", message: me instanceof Error ? me.message : "Unknown error" }] };
  }
}
