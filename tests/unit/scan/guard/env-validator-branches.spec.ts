import { describe, expect, it } from "vitest";
import { createEnv } from "../../../../src/scan/guard/env-validator.js";
import { EnvValidationError } from "../../../../src/scan/guard/errors/env-validation-error.js";

describe("createEnv branches", () => {
  it("prefers runtimeEnvStrict over runtimeEnv and strips empty strings by default", async () => {
    const result = await createEnv({
      runtimeEnvStrict: { FOO: "bar", EMPTY: "" },
      runtimeEnv: { IGNORED: "x" },
      extends: [],
      engine: "custom",
    });
    expect(result.env).toEqual({ FOO: "bar" });
    expect(result.unknownKeys).toEqual(["FOO"]);
    expect(result.engine).toBe("custom");
  });

  it("falls back to runtimeEnv and keeps empty strings when emptyStringAsUndefined is false", async () => {
    const result = await createEnv({
      runtimeEnv: { FOO: "bar", EMPTY: "" },
      emptyStringAsUndefined: false,
      extends: [],
      engine: "custom",
    });
    expect(result.env).toEqual({ FOO: "bar", EMPTY: "" });
  });

  it("uses an empty env when neither runtime env is provided and auto-detects presets", async () => {
    const result = await createEnv({ engine: "custom" });
    expect(result.env).toEqual({});
    expect(result.unknownKeys).toEqual([]);
  });

  it("throws EnvValidationError carrying the engine name on validation failure", async () => {
    const err = await createEnv({
      runtimeEnv: { PORT: "99999" },
      engine: "custom",
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EnvValidationError);
    const typed = err as EnvValidationError;
    expect(typed.message).toBe("Muraqib Semantic Validation Failed");
    expect(typed.engine).toBe("custom");
    expect(typed.errors.length).toBeGreaterThan(0);
  });
});
