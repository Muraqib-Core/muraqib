import { describe, it, expect } from "vitest";
import { z } from "zod";
import { createGuard, GuardValidationError } from "./standard.js";

describe("createGuard", () => {
  const schema = z.object({ A: z.string(), N: z.coerce.number() });
  it("returns parsed data", () => {
    expect(createGuard(schema, { runtimeEnv: { A: "x", N: "2" } }).data).toEqual({ A: "x", N: 2 });
  });
  it("throws GuardValidationError with message and zod issues", () => {
    let caught: unknown;
    try { createGuard(schema, { runtimeEnv: {} }); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(GuardValidationError);
    expect(caught).toBeInstanceOf(Error);
    const err = caught as GuardValidationError;
    expect(err.message).toBe("Validation Failed");
    expect(err.errors.length).toBeGreaterThan(0);
    expect(err.errors[0]?.path).toEqual(["A"]);
  });
});
