import { describe, expect, test } from "vitest";
import { z } from "zod";
import { cachePerformanceSchema } from "../../../src/rules/cache-guard.js";

const schema = z.object(cachePerformanceSchema);

describe("cachePerformanceSchema", () => {
  test("accepts a one-day max-age given as a string and coerces it to a number", () => {
    const result = schema.parse({ STATIC_ASSETS_CACHE_MAX_AGE: "86400", ENABLE_SERVER_COMPRESSION: "true" });
    expect(result.STATIC_ASSETS_CACHE_MAX_AGE).toBe(86400);
  });

  test("accepts a numeric max-age above the minimum", () => {
    const result = schema.parse({ STATIC_ASSETS_CACHE_MAX_AGE: 31536000, ENABLE_SERVER_COMPRESSION: true });
    expect(result.STATIC_ASSETS_CACHE_MAX_AGE).toBe(31536000);
  });

  test("rejects a max-age below one day", () => {
    const result = schema.safeParse({ STATIC_ASSETS_CACHE_MAX_AGE: "86399", ENABLE_SERVER_COMPRESSION: "true" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain("at least 1 day");
  });

  test("rejects a non-numeric max-age", () => {
    const result = schema.safeParse({ STATIC_ASSETS_CACHE_MAX_AGE: "abc", ENABLE_SERVER_COMPRESSION: "true" });
    expect(result.success).toBe(false);
  });

  test.each(["TRUE", "true", true])(
    "treats %s as compression enabled",
    (value) => {
      const result = schema.parse({ STATIC_ASSETS_CACHE_MAX_AGE: 86400, ENABLE_SERVER_COMPRESSION: value });
      expect(result.ENABLE_SERVER_COMPRESSION).toBe(true);
    }
  );

  test.each(["false", "0", false])("rejects compression value %s", (value) => {
    const result = schema.safeParse({ STATIC_ASSETS_CACHE_MAX_AGE: 86400, ENABLE_SERVER_COMPRESSION: value });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain("Compression is disabled");
  });
});
