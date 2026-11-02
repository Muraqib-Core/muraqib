import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { homedir } from "node:os";
import { join } from "node:path";
import { CACHE_DIR_ENV } from "../../../../src/agent-v2/explain/config.js";
import { defaultCacheDir } from "../../../../src/agent-v2/explain/cache.js";

describe("defaultCacheDir resolution", () => {
  beforeEach(() => {
    vi.stubEnv(CACHE_DIR_ENV, "");
    vi.stubEnv("XDG_CACHE_HOME", "");
  });
  afterEach(() => vi.unstubAllEnvs());

  test("empty override and empty XDG fall back to ~/.cache", () => {
    expect(defaultCacheDir()).toBe(join(homedir(), ".cache", "muraqib-agent"));
  });
  test("XDG_CACHE_HOME is used when set", () => {
    vi.stubEnv("XDG_CACHE_HOME", join("/x", "cache"));
    expect(defaultCacheDir()).toBe(join("/x", "cache", "muraqib-agent"));
  });
  test("override wins over XDG", () => {
    vi.stubEnv("XDG_CACHE_HOME", "/x");
    vi.stubEnv(CACHE_DIR_ENV, "/o");
    expect(defaultCacheDir()).toBe("/o");
  });
});
