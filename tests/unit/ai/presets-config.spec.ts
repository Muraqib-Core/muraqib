import { afterEach, describe, expect, test, vi } from "vitest";
import {
  MURAQIB_LOCAL_PRESETS,
  fetchRemoteMuraqibPresets,
} from "../../../src/config/presets.js";

describe("fetchRemoteMuraqibPresets", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test("returns the remote groups when the response is an array", async () => {
    const groups = [{ groupName: "g", packages: ["a"] }];
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => groups })));
    expect(await fetchRemoteMuraqibPresets("http://x")).toEqual(groups);
  });

  test("falls back to local presets when the payload is not an array", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({}) })));
    expect(await fetchRemoteMuraqibPresets("http://x")).toBe(MURAQIB_LOCAL_PRESETS);
  });

  test("falls back and warns on a non-ok status", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500 })));
    expect(await fetchRemoteMuraqibPresets("http://x")).toBe(MURAQIB_LOCAL_PRESETS);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("500"));
  });

  test("falls back and warns on a network error", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    expect(await fetchRemoteMuraqibPresets("http://x")).toBe(MURAQIB_LOCAL_PRESETS);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Network connection error"));
  });
});
