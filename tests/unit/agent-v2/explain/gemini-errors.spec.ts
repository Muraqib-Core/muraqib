import { describe, expect, test } from "vitest";
import { describeGeminiError } from "../../../../src/agent-v2/explain/gemini.js";

const KEY = ["AQ", "Ab8RN6IzBS", "FAKEKEYFORTESTS"].join(".");

describe("describeGeminiError", () => {
  test.each([
    [{ status: 400, message: "API key not valid. Please pass a valid API key." }, "HTTP 400: the API key was rejected as invalid"],
    [{ status: 400, message: "API_KEY_INVALID" }, "HTTP 400: the API key was rejected as invalid"],
    [{ status: 400, message: "bad request" }, "HTTP 400: the request was rejected"],
    [{ status: 401 }, "HTTP 401: authentication failed"],
    [{ status: 403 }, "HTTP 403: permission denied"],
    [{ status: 404 }, "HTTP 404: model not found"],
    [{ status: 503 }, "HTTP 503: Gemini server error"],
    [{ status: 418 }, "HTTP 418: unexpected response"],
  ])("%j", (error, expected) => {
    expect(describeGeminiError(error)).toContain(expected);
    expect(describeGeminiError(error)).toMatch(/^Gemini request failed \(/);
  });

  test("network errors show only an upper-case code", () => {
    expect(describeGeminiError({ code: "ENOTFOUND" })).toContain("network error ENOTFOUND");
    expect(describeGeminiError({ cause: { code: "ETIMEDOUT" } })).toContain("network error ETIMEDOUT");
    expect(describeGeminiError({ code: "not a code" })).toBe("Gemini request failed");
  });

  test("unknown shapes fall back to the plain message", () => {
    for (const value of [undefined, null, "boom", 42, {}]) expect(describeGeminiError(value)).toBe("Gemini request failed");
  });

  test("never copies the error message, so a key inside it cannot leak", () => {
    const text = describeGeminiError({ status: 400, message: `API key not valid: ${KEY}` });
    expect(text).not.toContain(KEY);
    expect(text).not.toContain("AQ.");
    expect(describeGeminiError({ status: 500, message: `server said ${KEY}` })).not.toContain(KEY);
  });
});
