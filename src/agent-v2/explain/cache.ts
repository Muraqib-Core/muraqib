import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { CACHE_DIR_ENV, MAX_CACHE_ENTRIES } from "./config.js";

interface CacheEntry {
  text: string;
  at: number;
}

interface CacheFile {
  version: 1;
  entries: Record<string, CacheEntry>;
}

/** Default folder: `$MURAQIB_AGENT_CACHE_DIR`, else `$XDG_CACHE_HOME/muraqib-agent`, else `~/.cache/muraqib-agent`. */
export function defaultCacheDir(): string {
  const override = process.env[CACHE_DIR_ENV];
  if (override !== undefined && override !== "") return override;
  const xdg = process.env.XDG_CACHE_HOME;
  return join(xdg !== undefined && xdg !== "" ? xdg : join(homedir(), ".cache"), "muraqib-agent");
}

/** Cache key: the same issue id explained in the same language by the same model is never sent twice. */
export function cacheKey(model: string, lang: string, issueId: string): string {
  return `${model}:${lang}:${issueId}`;
}

/**
 * On-disk explanation cache keyed by issue id. Reads and writes never throw: a missing,
 * corrupt or read-only cache simply behaves as an empty one.
 */
export class ExplainCache {
  private readonly file: string;
  private data: CacheFile;

  constructor(private readonly dir: string = defaultCacheDir()) {
    this.file = join(dir, "explanations.json");
    this.data = this.load();
  }

  private load(): CacheFile {
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.file, "utf-8"));
      if (typeof parsed === "object" && parsed !== null && (parsed as { version?: unknown }).version === 1) {
        const entries = (parsed as { entries?: unknown }).entries;
        if (typeof entries === "object" && entries !== null) return { version: 1, entries: entries as Record<string, CacheEntry> };
      }
    } catch {
      // missing or corrupt cache: start empty
    }
    return { version: 1, entries: {} };
  }

  get(key: string): string | undefined {
    const entry = this.data.entries[key];
    return typeof entry?.text === "string" ? entry.text : undefined;
  }

  set(key: string, text: string): void {
    this.data.entries[key] = { text, at: Date.now() };
  }

  /** Persists the cache (oldest entries dropped past the cap). Returns false when the disk write failed. */
  save(): boolean {
    const keys = Object.keys(this.data.entries);
    if (keys.length > MAX_CACHE_ENTRIES) {
      keys
        .sort((a, b) => (this.data.entries[a]?.at ?? 0) - (this.data.entries[b]?.at ?? 0))
        .slice(0, keys.length - MAX_CACHE_ENTRIES)
        .forEach((key) => delete this.data.entries[key]);
    }
    try {
      mkdirSync(this.dir, { recursive: true });
      const tmp = `${this.file}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.data), "utf-8");
      renameSync(tmp, this.file);
      return true;
    } catch {
      return false;
    }
  }
}
