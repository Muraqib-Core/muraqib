import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("warnIfGenAIMissing", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(async () => {
    (await import("../../../src/shared/logger.js")).setSilentMode(false);
    vi.restoreAllMocks();
  });

  async function load() {
    const { warnIfGenAIMissing } = await import("../../../src/ai/gemini-client.js");
    const { MissingOptionalDependencyError } = await import("../../../src/utils/optional-dependency.js");
    const logger = await import("../../../src/shared/logger.js");
    return { warnIfGenAIMissing, MissingOptionalDependencyError, logger };
  }

  it("warns once per process through the shared logger", async () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { warnIfGenAIMissing, MissingOptionalDependencyError } = await load();
    const err = new MissingOptionalDependencyError("@google/genai", "the Gemini AI advisor");
    warnIfGenAIMissing(err);
    warnIfGenAIMissing(err);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0]).toContain("AI advisor disabled");
  });

  it("honours silent mode", async () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { warnIfGenAIMissing, MissingOptionalDependencyError, logger } = await load();
    logger.setSilentMode(true);
    warnIfGenAIMissing(new MissingOptionalDependencyError("@google/genai", "the Gemini AI advisor"));
    expect(spy).not.toHaveBeenCalled();
  });

  it("ignores unrelated errors", async () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { warnIfGenAIMissing } = await load();
    warnIfGenAIMissing(new Error("other"));
    expect(spy).not.toHaveBeenCalled();
  });
});
