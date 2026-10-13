import { afterEach, describe, expect, it } from "vitest";
import { resolveApiKey } from "../../../src/ai/advisor.js";

const saved = { gemini: process.env.GEMINI_API_KEY, google: process.env.GOOGLE_API_KEY };

const restore = (name: "GEMINI_API_KEY" | "GOOGLE_API_KEY", value: string | undefined): void => {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
};

afterEach(() => {
  restore("GEMINI_API_KEY", saved.gemini);
  restore("GOOGLE_API_KEY", saved.google);
});

describe("resolveApiKey", () => {
  it("prefers an explicit key", () => {
    process.env.GEMINI_API_KEY = "gemini-key";
    expect(resolveApiKey("explicit")).toBe("explicit");
  });

  it("treats empty strings as missing and falls through to the next source", () => {
    process.env.GEMINI_API_KEY = "";
    process.env.GOOGLE_API_KEY = "google-key";
    expect(resolveApiKey("")).toBe("google-key");
    process.env.GEMINI_API_KEY = "gemini-key";
    expect(resolveApiKey(undefined)).toBe("gemini-key");
  });

  it("returns undefined when every source is empty or unset", () => {
    process.env.GEMINI_API_KEY = "";
    delete process.env.GOOGLE_API_KEY;
    expect(resolveApiKey("")).toBeUndefined();
  });
});
