import { describe, expect, it } from "vitest";
import { z, ZodError } from "zod";
import type { ZodSchema } from "zod";
import { ZodEngine } from "../../../../src/guard/engines/zod-engine";

/** Build a schema-like object whose parse throws the given value. */
function fakeZodError(issues: unknown): ZodError {
  const fake = Object.create(new ZodError([])) as ZodError;
  Object.defineProperty(fake, "issues", { value: issues });
  return fake;
}

function throwingSchema(thrown: unknown): ZodSchema {
  return { parse: () => { throw thrown; } } as unknown as ZodSchema;
}

describe("ZodEngine non-Zod and malformed errors", () => {
  it("validate maps a non-Zod throw to an unknown-error issue", () => {
    const result = new ZodEngine(throwingSchema(new Error("boom"))).validate(1);
    expect(result.success).toBe(false);
    expect(result.raw).toBeUndefined();
    expect(result.errors).toHaveLength(1);
  });

  it("validatePartial maps a non-Zod throw from a ZodObject partial parse", () => {
    const objectSchema = z.object({ a: z.string() });
    Object.defineProperty(objectSchema, "partial", {
      value: () => ({ parse: () => { throw new Error("partial failed"); } }),
    });
    const result = new ZodEngine(objectSchema).validatePartial({});
    expect(result.success).toBe(false);
    expect(result.raw).toBeUndefined();
    expect(result.errors).toHaveLength(1);
  });

  it("validatePartial returns ZodError details for invalid partial data", () => {
    const result = new ZodEngine(z.object({ a: z.string() })).validatePartial({ a: 1 });
    expect(result.success).toBe(false);
    expect(result.errors[0]?.field).toBe("a");
  });

  it("tolerates a ZodError without issues or paths", () => {
    const noIssues = fakeZodError(undefined);
    const a = new ZodEngine(throwingSchema(noIssues)).validate(1);
    expect(a.success).toBe(false);
    expect(a.errors).toEqual([]);

    const pathless = fakeZodError([{ message: "bad", code: "custom" }]);
    const b = new ZodEngine(throwingSchema(pathless)).validate(1);
    expect(b.errors[0]).toMatchObject({ field: "root", message: "bad", code: "custom", path: [] });
  });

  it("filters symbol path segments", () => {
    const sym = fakeZodError([{ message: "bad", code: "custom", path: ["x", Symbol("s"), 2] }]);
    const r = new ZodEngine(throwingSchema(sym)).validate(1);
    expect(r.errors[0]?.path).toEqual(["x", 2]);
  });
});
