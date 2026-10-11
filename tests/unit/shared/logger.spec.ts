import { afterEach, describe, expect, it, vi } from "vitest";
import { error, log, setSilentMode, warn } from "../../../src/shared/logger.js";

afterEach(() => {
  setSilentMode(false);
  vi.restoreAllMocks();
});

describe("shared logger", () => {
  it("forwards to the console when not silent", () => {
    const l = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const e = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const w = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    log("a", 1);
    error("b");
    warn("c");
    expect(l).toHaveBeenCalledWith("a", 1);
    expect(e).toHaveBeenCalledWith("b");
    expect(w).toHaveBeenCalledWith("c");
  });

  it("is silent in silent mode", () => {
    const l = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const e = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const w = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    setSilentMode(true);
    log("a");
    error("b");
    warn("c");
    expect(l).not.toHaveBeenCalled();
    expect(e).not.toHaveBeenCalled();
    expect(w).not.toHaveBeenCalled();
  });
});
