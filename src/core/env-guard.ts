import { z } from "zod";
import { BaseGuard } from "./base-guard.js";
import type { AuditContext, AuditResult } from "./types.js";
import { cachePerformanceSchema } from "../rules/cache-guard.js";
import { createEnvWithPresets, safeCreateEnv } from "../env/index.js";
import type { CreateEnvOptions } from "../env/index.js";
import type { PresetInput } from "../env/preset-map.js";
import { extractEnvErrors } from "../shared/utils.js";

export interface EnvGuardOptions {
  presets?: string[] | undefined;
  schedule?: string | undefined;
  /** Collect every violation instead of throwing on the first failure. */
  safe?: boolean | undefined;
}

/**
 * Validates the process environment (DATABASE_URL, PORT, cache settings and any presets) with the env engine.
 * Severity levels used: error.
 */
export class EnvGuard extends BaseGuard {
  private readonly options: EnvGuardOptions;

  constructor(options: EnvGuardOptions = {}, context?: AuditContext) {
    super("env-guard", context);
    this.options = options;
  }

  async execute(): Promise<AuditResult> {
    const errors = this.validate();
    if (errors.length === 0) return this.ok("All environment variables are valid");
    return this.issues(
      errors.map((message) => this.createIssue("ENV_INVALID", "error", "Invalid environment variable", message, undefined, undefined, ["env"])),
      `${errors.length} environment violation(s)`
    );
  }

  /** Every violation as a `path: message` line; empty when the environment is valid. */
  private validate(): string[] {
    const schema = {
      DATABASE_URL: z.string().url().optional(),
      PORT: z
        .string()
        .regex(/^\d+$/, "PORT must be a numeric string")
        .optional()
        .transform((v) => Number(v ?? "3000")),
      ...cachePerformanceSchema,
    };

    const envOptions = {
      server: schema,
      runtimeEnv: process.env as Record<string, string | undefined>,
      isServer: true,
      silent: true,
      ...(this.options.presets ? { presets: this.options.presets as PresetInput[] } : {}),
      ...(this.options.schedule ? { schedule: this.options.schedule } : {}),
    } as unknown as CreateEnvOptions;

    try {
      if (this.options.safe) {
        const result = safeCreateEnv(envOptions);
        return result.success ? [] : result.error.map((e) => `${e.path}: ${e.message}`);
      }
      createEnvWithPresets(schema, envOptions as unknown as Parameters<typeof createEnvWithPresets>[1]);
      return [];
    } catch (err: unknown) {
      return extractEnvErrors(err);
    }
  }
}
