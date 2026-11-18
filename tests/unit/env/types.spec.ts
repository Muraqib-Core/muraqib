import { describe, expect, expectTypeOf, test } from "vitest";
import { z } from "zod";
import { createEnv } from "../../../src/env/index.js";

// Compile-time checks: `npm run type-check:tests` fails if an expectation below stops holding.
describe("createEnv typing", () => {
  test("accepts server keys without a clientPrefix and infers their types", () => {
    const env = createEnv({ server: { DB: z.string(), N: z.coerce.number() }, runtimeEnv: { DB: "d", N: "1" }, silent: true });
    expectTypeOf(env).toMatchTypeOf<{ DB: string; N: number } | null>();
    expect(env).toEqual({ DB: "d", N: 1 });
  });

  test("infers server and client keys together when a prefix is set", () => {
    const env = createEnv({
      server: { DB: z.string() },
      client: { PUB_URL: z.string() },
      clientPrefix: "PUB_",
      runtimeEnv: { DB: "d", PUB_URL: "u" },
      silent: true,
    });
    expectTypeOf(env).toMatchTypeOf<{ DB: string; PUB_URL: string } | null>();
    expect(env).toEqual({ DB: "d", PUB_URL: "u" });
  });

  test("rejects a prefixed key in server and an unprefixed key in client", () => {
    const run = (fn: () => unknown): void => {
      try {
        fn();
      } catch {
        // validation failures are irrelevant here; only the compile-time errors matter
      }
    };
    run(() =>
      // @ts-expect-error server keys must not carry the client prefix
      createEnv({ server: { PUB_DB: z.string() }, clientPrefix: "PUB_", runtimeEnv: {}, silent: true })
    );
    run(() =>
      // @ts-expect-error client keys must carry the client prefix
      createEnv({ client: { DB: z.string() }, clientPrefix: "PUB_", runtimeEnv: {}, silent: true })
    );
    expect(true).toBe(true);
  });
});
