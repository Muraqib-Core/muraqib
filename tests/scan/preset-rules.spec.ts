import { describe, expect, test } from "vitest";
import { PRESET_RULES, detectPresets, validateField } from "../../src/scan/guard/rules/preset-rules.js";

describe("validateField", () => {
  test("accepts values that satisfy every constraint", () => {
    expect(validateField("K", "abc", { minLength: 1, maxLength: 5, regex: /^a/, message: "m" })).toBeNull();
  });

  test("rejects values outside allowedValues, length bounds, regex or custom check", () => {
    expect(validateField("K", "x", { allowedValues: ["a"], message: "allowed" })).toBe("allowed");
    expect(validateField("K", "a", { minLength: 2, message: "short" })).toBe("short");
    expect(validateField("K", "abcdef", { maxLength: 3, message: "long" })).toBe("long");
    expect(validateField("K", "b", { regex: /^a/, message: "regex" })).toBe("regex");
    expect(validateField("K", "b", { customCheck: () => false, message: "custom" })).toBe("custom");
  });

  test("passes a rule with no constraints", () => {
    expect(validateField("K", "anything", { message: "m" })).toBeNull();
  });
});

describe("detectPresets", () => {
  test("always includes the app preset", () => {
    expect(detectPresets({})).toEqual(["app"]);
  });

  test.each([
    [{ DATABASE_URL: "x" }, "neon"],
    [{ SUPABASE_URL: "x" }, "supabase"],
    [{ SUPABASE_ANON_KEY: "x" }, "supabase"],
    [{ AWS_ACCESS_KEY_ID: "x" }, "aws"],
    [{ AWS_REGION: "x" }, "aws"],
    [{ MONGODB_URI: "x" }, "mongodb"],
    [{ MONGODB_URL: "x" }, "mongodb"],
    [{ REDIS_URL: "x" }, "redis"],
    [{ JWT_SECRET: "x" }, "auth"],
    [{ NEXTAUTH_SECRET: "x" }, "auth"],
    [{ CLOUDINARY_URL: "x" }, "cloudinary"],
    [{ CLOUDINARY_CLOUD_NAME: "x" }, "cloudinary"],
    [{ PGHOST: "x" }, "pg"],
    [{ PGUSER: "x" }, "pg"],
    [{ VERCEL_ENV: "x" }, "vercel"],
    [{ VERCEL_URL: "x" }, "vercel"],
  ])("detects %j as %s", (env, preset) => {
    expect(detectPresets(env as Record<string, string>)).toContain(preset);
  });
});

describe("PRESET_RULES", () => {
  const check = (preset: string, key: string, value: string): string | null =>
    validateField(key, value, PRESET_RULES[preset]![key]!);

  test("app rules", () => {
    expect(check("app", "NODE_ENV", "production")).toBeNull();
    expect(check("app", "NODE_ENV", "prod")).not.toBeNull();
    expect(check("app", "PORT", "8080")).toBeNull();
    expect(check("app", "PORT", "80")).not.toBeNull();
    expect(check("app", "PORT", "abc")).not.toBeNull();
    expect(check("app", "CORS_ORIGIN", "*")).toBeNull();
    expect(check("app", "CORS_ORIGIN", "https://a.com")).toBeNull();
    expect(check("app", "CORS_ORIGIN", "a.com")).not.toBeNull();
    expect(check("app", "LOG_LEVEL", "debug")).toBeNull();
    expect(check("app", "LOG_LEVEL", "loud")).not.toBeNull();
  });

  test("auth secrets require 32 characters", () => {
    expect(check("auth", "JWT_SECRET", "x".repeat(32))).toBeNull();
    expect(check("auth", "JWT_SECRET", "short")).not.toBeNull();
  });

  test("postgres rules", () => {
    expect(check("pg", "PGPORT", "5432")).toBeNull();
    expect(check("pg", "PGPORT", "0")).not.toBeNull();
    expect(check("pg", "PGPORT", "70000")).not.toBeNull();
    expect(check("pg", "PGPORT", "abc")).not.toBeNull();
    for (const key of ["PGHOST", "PGUSER", "PGPASSWORD", "PGDATABASE"]) {
      expect(check("pg", key, "")).not.toBeNull();
      expect(check("pg", key, "v")).toBeNull();
    }
  });

  test("connection string rules", () => {
    expect(check("mongodb", "MONGODB_URI", "mongodb+srv://h")).toBeNull();
    expect(check("mongodb", "MONGODB_URI", "http://h")).not.toBeNull();
    expect(check("redis", "REDIS_URL", "rediss://h")).toBeNull();
    expect(check("redis", "REDIS_URL", "http://h")).not.toBeNull();
    expect(check("neon", "DATABASE_URL", "postgresql://h")).toBeNull();
    expect(check("neon", "DATABASE_URL", "mysql://h")).not.toBeNull();
  });

  test("vercel environment values", () => {
    expect(check("vercel", "VERCEL_ENV", "preview")).toBeNull();
    expect(check("vercel", "VERCEL_ENV", "qa")).not.toBeNull();
  });
});
