import type { GuardSchema } from "../core/types.js";
import type { ErrorMessage } from "./types.js";

/**
 * True only when a concrete, non-empty client prefix was supplied. With the default `""` (or a widened
 * `string`) every key would match the prefix, so the server/client key checks are switched off.
 */
type PrefixEnforced<TPrefix extends string> = string extends TPrefix ? false : TPrefix extends "" ? false : true;

export interface CreateEnvOptions<
  TPrefix extends string = "",
  TServer extends GuardSchema = Record<string, never>,
  TClient extends GuardSchema = Record<string, never>,
  TExtends extends unknown[] = []
> {
  clientPrefix?: TPrefix;
  server?: {
    [K in keyof TServer]: PrefixEnforced<TPrefix> extends true
      ? K extends `${TPrefix}${string}`
        ? ErrorMessage<`❌ خطأ منطقي: المتغير "${K & string}" يحمل البادئة المخصصة للعميل، يرجى نقله إلى كائن الـ client.`>
        : TServer[K]
      : TServer[K];
  };
  client?: {
    [K in keyof TClient]: PrefixEnforced<TPrefix> extends true
      ? K extends `${TPrefix}${string}`
        ? TClient[K]
        : ErrorMessage<`❌ خطأ أمني: المتغير "${K & string}" لا يحمل البادئة الآمنة "${TPrefix}"، يرجى نقله للسيرفر.`>
      : TClient[K];
  };
  runtimeEnvStrict?: Record<string, unknown>;
  runtimeEnv?: Record<string, string | undefined>;
  extends?: TExtends;
  emptyStringAsUndefined?: boolean;
  isServer?: boolean;
  schedule?: string;
  skipValidation?: boolean;
  silent?: boolean;
  formatError?: (issues: Array<{ path: string; message: string }>) => string;
  envFilePath?: string | string[];
  preserveProcessEnv?: boolean;
  /** Let values from `envFilePath` replace variables already present in `process.env` (default: the real environment wins). */
  overrideProcessEnv?: boolean;
}
