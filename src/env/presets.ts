import { z } from "zod";
import { presetsMap } from "../presets.js";
import type { PresetInput } from "../presets.js";
import { createEnv } from "./core.js";
import type { CreateEnvOptions } from "./options.js";

export function createEnvWithPresets<T extends Record<string, z.ZodTypeAny>>(
  userSchema: T,
  options: {
    runtimeEnv: Record<string, string | undefined>;
    isServer?: boolean;
    emptyStringAsUndefined?: boolean;
    presets?: PresetInput[];
    schedule?: string;
    skipValidation?: boolean;
    silent?: boolean;
    formatError?: (issues: Array<{ path: string; message: string }>) => string;
    envFilePath?: string | string[];
    preserveProcessEnv?: boolean;
  }
): z.infer<z.ZodObject<T>> | null {

  const serverSchema: Record<string, z.ZodTypeAny> = { ...userSchema };

  if (options.presets && Array.isArray(options.presets)) {
    for (const presetName of options.presets) {
      const preset = presetsMap[presetName];
      if (preset) {
        if (!options.silent) {
          console.log(`📦 [Muraqib Presets]: Injecting centralized validation schema for [${presetName}].`);
        }
        Object.assign(serverSchema, preset);
      } else if (!options.silent) {
        console.warn(`⚠️ [Muraqib Presets]: Unknown preset [${presetName}] — skipped.`);
      }
    }
  }

  const callOpts = {
    server: serverSchema,
    runtimeEnv: options.runtimeEnv ?? process.env,
  } as unknown as CreateEnvOptions;
  if (options.emptyStringAsUndefined !== undefined) callOpts.emptyStringAsUndefined = options.emptyStringAsUndefined;
  if (options.isServer !== undefined) callOpts.isServer = options.isServer;
  if (options.schedule !== undefined) callOpts.schedule = options.schedule;
  if (options.skipValidation !== undefined) callOpts.skipValidation = options.skipValidation;
  if (options.silent !== undefined) callOpts.silent = options.silent;
  if (options.formatError !== undefined) callOpts.formatError = options.formatError;
  if (options.envFilePath !== undefined) callOpts.envFilePath = options.envFilePath;
  if (options.preserveProcessEnv !== undefined) callOpts.preserveProcessEnv = options.preserveProcessEnv;

  return createEnv(callOpts) as z.infer<z.ZodObject<T>> | null;
}
