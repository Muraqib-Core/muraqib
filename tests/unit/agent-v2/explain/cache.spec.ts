import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { cacheKey, defaultCacheDir, ExplainCache } from "../../../../src/agent-v2/explain/cache.js";
import { CACHE_DIR_ENV, GEMINI_MODEL, MAX_CACHE_ENTRIES } from "../../../../src/agent-v2/explain/config.js";

let dir: string;
let savedEnv: string | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "agent-v2-cache-"));
  savedEnv = process.env[CACHE_DIR_ENV];
});
afterEach(() => {
  if (savedEnv === undefined) delete process.env[CACHE_DIR_ENV];
  else process.env[CACHE_DIR_ENV] = savedEnv;
  rmSync(dir, { recursive: true, force: true });
});

describe("ExplainCache", () => {
  test("set, save and reload", () => {
    const cache = new ExplainCache(dir);
    expect(cache.get("k")).toBeUndefined();
    cache.set("k", "hello");
    expect(cache.get("k")).toBe("hello");
    expect(cache.save()).toBe(true);
    expect(new ExplainCache(dir).get("k")).toBe("hello");
  });

  test("creates a missing nested directory on save", () => {
    const nested = join(dir, "a", "b");
    const cache = new ExplainCache(nested);
    cache.set("k", "v");
    expect(cache.save()).toBe(true);
    expect(existsSync(join(nested, "explanations.json"))).toBe(true);
  });

  test.each(["{not json", "[]", JSON.stringify({ version: 2, entries: {} }), JSON.stringify({ version: 1 })])(
    "corrupt or foreign file behaves as empty (%s)",
    (content) => {
      writeFileSync(join(dir, "explanations.json"), content);
      const cache = new ExplainCache(dir);
      expect(cache.get("k")).toBeUndefined();
      cache.set("k", "v");
      expect(cache.save()).toBe(true);
    }
  );

  test("unwritable location returns false and does not throw", () => {
    // A regular file where the directory should be makes mkdir fail regardless of user privileges.
    const blocker = join(dir, "blocker");
    writeFileSync(blocker, "x");
    const cache = new ExplainCache(join(blocker, "sub"));
    cache.set("k", "v");
    expect(() => cache.save()).not.toThrow();
    expect(cache.save()).toBe(false);
    expect(cache.get("k")).toBe("v");
  });

  test("read-only directory does not throw", () => {
    const ro = join(dir, "ro");
    mkdirSync(ro);
    chmodSync(ro, 0o500);
    const cache = new ExplainCache(ro);
    cache.set("k", "v");
    expect(() => cache.save()).not.toThrow();
    chmodSync(ro, 0o700);
  });

  test("caps entries at MAX_CACHE_ENTRIES, dropping the oldest", () => {
    const cache = new ExplainCache(dir);
    const total = MAX_CACHE_ENTRIES + 20;
    for (let i = 0; i < total; i += 1) cache.set(`k${i}`, `v${i}`);
    expect(cache.save()).toBe(true);
    const reloaded = new ExplainCache(dir);
    let present = 0;
    for (let i = 0; i < total; i += 1) if (reloaded.get(`k${i}`) !== undefined) present += 1;
    expect(present).toBe(MAX_CACHE_ENTRIES);
    expect(reloaded.get(`k${total - 1}`)).toBe(`v${total - 1}`);
  });
});

describe("cacheKey / defaultCacheDir", () => {
  test("key includes model, language and issue id", () => {
    const key = cacheKey(GEMINI_MODEL, "ar", "issue-1");
    expect(key).toContain(GEMINI_MODEL);
    expect(key).toContain("ar");
    expect(key).toContain("issue-1");
    expect(cacheKey("m", "en", "i")).not.toBe(cacheKey("m", "ar", "i"));
    expect(cacheKey("m", "en", "i")).not.toBe(cacheKey("m2", "en", "i"));
    expect(cacheKey("m", "en", "i")).not.toBe(cacheKey("m", "en", "j"));
  });

  test("env override wins", () => {
    process.env[CACHE_DIR_ENV] = dir;
    expect(defaultCacheDir()).toBe(dir);
  });
});
