import type { GuardSchema } from "../core/types.js";

export type InferSchema<T extends GuardSchema> = {
  [K in keyof T]: T[K] extends { ["~standard"]: { types: { output: infer O } } }
    ? O
    : T[K] extends { _output: infer O }
    ? O
    : T[K] extends { infer: infer O }
    ? O
    : unknown;
};

export type IntersectExtension<T extends unknown[]> = T extends [infer Head, ...infer Tail]
  ? Head extends Record<string, unknown>
    ? Head & IntersectExtension<Tail>
    : IntersectExtension<Tail>
  : unknown;

export type ErrorMessage<T extends string> = T & { __brand: "ErrorMessage" };
