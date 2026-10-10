import { describe, expect, test } from "vitest";
import { z } from "zod";
import { createGuard } from "../../../src/core/standard.js";

describe("createGuard", () => {
  const schema = z.object({ PORT: z.string(), MODE: z.string().default("dev") });

  test("returns parsed data when the environment is valid", () => {
    const result = createGuard(schema, { runtimeEnv: { PORT: "3000" } });
    expect(result.data).toEqual({ PORT: "3000", MODE: "dev" });
  });

  test("throws a validation error object listing the issues", () => {
    try {
      createGuard(schema, { runtimeEnv: {} });
      expect.unreachable("createGuard should have thrown");
    } catch (error) {
      const thrown = error as { message: string; errors: Array<{ path: unknown[] }> };
      expect(thrown.message).toBe("Validation Failed");
      expect(thrown.errors[0]?.path).toEqual(["PORT"]);
    }
  });
});
