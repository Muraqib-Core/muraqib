import type { ValidationEngineName } from "../guard/core/engine-detector.js";

export interface parsedLine {
  line: number;
  key: string;
  value: string;
}

export interface syntaxIssue {
  line: number;
  type: "syntax";
  severity: "error" | "warning";
  message: string;
  key?: string | undefined;
}

/**
 * Standard Schema compatibility interface
 */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly "~standard": {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (value: unknown) => Promise<
      | { value: Output; issues?: never }
      | { issues: Array<{ message: string; path?: Array<string | number> }>; value?: never }
    >;
  };
}

export type GuardSchema = StandardSchemaV1<unknown, unknown> | Record<string, unknown>;

export interface GuardOptions {
  isServer?: boolean | undefined;
  emptyStringAsUndefined?: boolean | undefined;
  runtimeEnvStrict?: Record<string, string> | undefined;
  runtimeEnv?: Record<string, string> | undefined;
  extends?: string[] | undefined;
  engine?: ValidationEngineName | undefined;
  projectRoot?: string | undefined;
}