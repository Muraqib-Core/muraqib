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
    expect(await fetchRemoteMuraqibPresets("https://x.test/presets.json")).toEqual(groups);
  });

  test("rejects non-HTTPS and malformed URLs without fetching", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchRemoteMuraqibPresets("http://x.test/p.json")).toBe(MURAQIB_LOCAL_PRESETS);
    expect(await fetchRemoteMuraqibPresets("not a url")).toBe(MURAQIB_LOCAL_PRESETS);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("HTTPS"));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Invalid presets URL"));
  });

  test.each([
    [[{ groupName: "g", packages: ["a; rm -rf /"] }]],
    [[{ groupName: "", packages: ["a"] }]],
    [[{ groupName: "g", packages: [] }]],
    [[{ groupName: "g", packages: [1] }]],
    [["nope"]],
  ])("falls back when the schema is invalid (%j)", async (payload) => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => payload })));
    expect(await fetchRemoteMuraqibPresets("https://x.test/p.json")).toBe(MURAQIB_LOCAL_PRESETS);
  });

  test("falls back to local presets when the payload is not an array", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({}) })));
    expect(await fetchRemoteMuraqibPresets("https://x.test/presets.json")).toBe(MURAQIB_LOCAL_PRESETS);
  });

  test("falls back and warns on a non-ok status", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500 })));
    expect(await fetchRemoteMuraqibPresets("https://x.test/presets.json")).toBe(MURAQIB_LOCAL_PRESETS);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("500"));
  });

  test("falls back and warns on a network error", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    expect(await fetchRemoteMuraqibPresets("https://x.test/presets.json")).toBe(MURAQIB_LOCAL_PRESETS);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Network connection error"));
  });
});
