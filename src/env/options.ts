import type { GuardSchema } from "../core/types.js";
import type { ErrorMessage } from "./types.js";

export interface CreateEnvOptions<
  TPrefix extends string = "",
  TServer extends GuardSchema = Record<string, never>,
  TClient extends GuardSchema = Record<string, never>,
  TExtends extends unknown[] = []
> {
  clientPrefix?: TPrefix;
  server?: {
    [K in keyof TServer]: K extends `${TPrefix}${string}`
      ? ErrorMessage<`❌ خطأ مالي: المتغير "${K & string}" يحمل البادئة المخصصة للعميل، يرجى نقله إلى كائن الـ client.`>
      : TServer[K];
  };
  client?: {
    [K in keyof TClient]: K extends `${TPrefix}${string}`
      ? TClient[K]
      : ErrorMessage<`❌ خطأ أمني: المتغير "${K & string}" لا يحمل البادئة الآمنة "${TPrefix}"، يرجى نقله للسيرفر.`>;
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
}
