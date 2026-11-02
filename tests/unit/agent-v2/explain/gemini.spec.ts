import { beforeEach, describe, expect, test, vi } from "vitest";

const generateContent = vi.fn();
const createGeminiClient = vi.fn();
vi.mock("../../../../src/ai/gemini-client.js", () => ({
  createGeminiClient: (key: string): unknown => createGeminiClient(key),
}));

import { GEMINI_MODEL } from "../../../../src/agent-v2/explain/config.js";
import { createGeminiTextGenerator, isRateLimitError } from "../../../../src/agent-v2/explain/gemini.js";

beforeEach(() => {
  generateContent.mockReset();
  createGeminiClient.mockReset();
  createGeminiClient.mockResolvedValue({ models: { generateContent } });
});

describe("createGeminiTextGenerator", () => {
  test("sends the fixed model and config, returns the text", async () => {
    generateContent.mockResolvedValue({ text: "{\"a\":1}" });
    const fakeKey = ["fake", "key", "123"].join("-");
    const gen = await createGeminiTextGenerator(fakeKey);
    expect(createGeminiClient).toHaveBeenCalledWith(fakeKey);
    expect(await gen.generate({ system: "SYS", prompt: "PROMPT" })).toBe("{\"a\":1}");
    expect(generateContent).toHaveBeenCalledTimes(1);
    const arg = generateContent.mock.calls[0]?.[0] as { model: string; contents: string; config: Record<string, unknown> };
    expect(arg.model).toBe(GEMINI_MODEL);
    expect(arg.contents).toBe("PROMPT");
    expect(arg.config["systemInstruction"]).toBe("SYS");
    expect(arg.config["responseMimeType"]).toBe("application/json");
  });

  test("undefined text becomes an empty string", async () => {
    generateContent.mockResolvedValue({});
    const gen = await createGeminiTextGenerator("k");
    expect(await gen.generate({ system: "s", prompt: "p" })).toBe("");
  });

  test("client creation failure propagates", async () => {
    createGeminiClient.mockRejectedValue(new Error("missing dep"));
    await expect(createGeminiTextGenerator("k")).rejects.toThrow("missing dep");
  });
});

describe("isRateLimitError", () => {
  test.each([
    [null, false],
    ["429", false],
    [42, false],
    [{ status: 429 }, true],
    [{ status: 500 }, false],
    [{ message: "got HTTP 429 back" }, true],
    [{ message: "RESOURCE_exhausted: quota" }, true],
    [{ message: "error 4290" }, false],
    [{}, false],
    [{ status: 500, message: undefined }, false],
  ])("%j -> %s", (input, expected) => {
    expect(isRateLimitError(input)).toBe(expected);
  });
});
