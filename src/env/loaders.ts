import fs from "fs";
import path from "path";
import * as logger from "../shared/logger.js";
import { nonEmpty } from "../utils/defaults.js";

export interface LoadEnvOptions {
  cwd?: string;
  files?: string[];
  /** When set, nothing is written to `process.env`; the resolved values are only returned. */
  preserveProcessEnv?: boolean;
  /** Let file values replace variables already present in `process.env` (default: the real environment wins). */
  override?: boolean;
  verbose?: boolean;
}

/** A parsed assignment; `expand` is false for single-quoted and backtick values, which are literal. */
interface RawEntry {
  value: string;
  expand: boolean;
}

const KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_.-]*$/;
const INLINE_COMMENT = /(^|\s)#/;
const REFERENCE = /\\\$|\$\{([A-Za-z_][A-Za-z0-9_]*)(?:(:?)-([^}]*))?\}|\$([A-Za-z_][A-Za-z0-9_]*)/g;

/**
 * Reads a quoted value starting right after its opening quote on `lines[start]`. The value may span
 * several lines; a double-quoted value honours `\"` while reading and decodes `\n`, `\r`, `\t`, `\"`, `\\`.
 * Returns undefined when the closing quote never shows up (the caller then treats the line as unquoted).
 */
function readQuoted(
  lines: string[],
  start: number,
  afterQuote: string,
  quote: string
): { value: string; endLine: number } | undefined {
  let collected = "";
  let segment = afterQuote;
  for (let lineIndex = start; lineIndex < lines.length; lineIndex++) {
    let i = 0;
    while (i < segment.length) {
      const ch = segment[i];
      if (ch === "\\" && quote === '"') {
        i += 2;
        continue;
      }
      if (ch === quote) {
        const raw = collected + segment.slice(0, i);
        const value =
          quote === '"'
            ? raw.replace(/\\([nrt"\\])/g, (_, c: string) => (c === "n" ? "\n" : c === "r" ? "\r" : c === "t" ? "\t" : c))
            : raw;
        return { value, endLine: lineIndex };
      }
      i++;
    }
    collected += segment + "\n";
    segment = lines[lineIndex + 1] ?? "";
  }
  return undefined;
}

/**
 * Parses one file's content into `loaded`.
 *
 * - `KEY=value`, with an optional `export ` prefix and a valid identifier as key.
 * - `"..."`, `'...'` and backtick values may span several lines; only double quotes decode escapes
 *   and (like unquoted values) allow `$VAR` expansion.
 * - `#` starts a comment only at the start of a value or after whitespace, so `pa#ss` stays intact.
 * - An unquoted line ending in a backslash continues onto the next one; blank lines and comments are
 *   skipped inside a continuation, and a dangling backslash at end of file stays literal.
 */
function parseEnvContent(content: string, file: string, loaded: Map<string, RawEntry>, verbose: boolean): void {
  const record = (key: string, entry: RawEntry): void => {
    loaded.set(key, entry);
    if (verbose) {
      logger.log(`📄 [Muraqib Loader]: Loaded ${key} from ${file}`);
    }
  };

  const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/);
  let pending: { key: string; parts: string[] } | null = null;

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    if (pending !== null) {
      pending.parts.push(line);
      if (!line.endsWith("\\")) {
        record(pending.key, { value: joinContinuation(pending.parts), expand: true });
        pending = null;
      }
      continue;
    }

    const assignment = trimmed.replace(/^export\s+/, "");
    const eqIndex = assignment.indexOf("=");
    if (eqIndex < 0) continue;
    const key = assignment.slice(0, eqIndex).trim();
    if (!KEY_PATTERN.test(key)) continue;
    const rest = assignment.slice(eqIndex + 1).trimStart();

    const quote = rest[0];
    if (quote === '"' || quote === "'" || quote === "`") {
      const quoted = readQuoted(lines, index, rest.slice(1), quote);
      if (quoted) {
        record(key, { value: quoted.value, expand: quote === '"' });
        index = quoted.endLine;
        continue;
      }
    }

    const commentAt = INLINE_COMMENT.exec(rest);
    const value = (commentAt ? rest.slice(0, commentAt.index) : rest).trimEnd();
    if (value.endsWith("\\")) pending = { key, parts: [value] };
    else record(key, { value, expand: true });
  }

  if (pending !== null) record(pending.key, { value: pending.parts.join("\n"), expand: true });
}

/** Joins the lines of a backslash-continued value, dropping each continuation backslash. */
function joinContinuation(parts: string[]): string {
  return parts.map((part) => part.replace(/\\$/, "").trimEnd()).join("\n");
}

/**
 * Load env.
 *
 * Values from the files are expanded (`$VAR`, `${VAR}`, `${VAR:-default}`, `${VAR-default}`, `\$` for a
 * literal dollar) and merged into `process.env`. Variables that already exist in the real environment
 * win unless `override` is set. The returned record holds the values in effect for every key found in the files.
 *
 * @param options - Options
 * @returns Load env result
 */
export function loadEnv(options: LoadEnvOptions = {}): Record<string, string> {
  const cwd = options.cwd ?? process.cwd();
  const nodeEnv = process.env.NODE_ENV ?? "development";
  const files = options.files ?? [".env", `.env.${nodeEnv}`, ".env.local"];
  const entries = new Map<string, RawEntry>();
  const verbose = Boolean(options.verbose);

  for (const file of files) {
    const filePath = path.join(cwd, file);
    if (!fs.existsSync(filePath)) continue;

    try {
      parseEnvContent(fs.readFileSync(filePath, "utf-8"), file, entries, verbose);
    } catch {
      logger.warn(`⚠️ [Muraqib Loader]: Failed to load ${filePath}`);
    }
  }

  const loaded = resolveEntries(entries, Boolean(options.override), verbose);

  if (!options.preserveProcessEnv) {
    for (const [k, v] of Object.entries(loaded)) {
      process.env[k] = v;
    }
  }

  process.env.PORT = nonEmpty(process.env.PORT, "3000");
  process.env.STATIC_ASSETS_CACHE_MAX_AGE = nonEmpty(process.env.STATIC_ASSETS_CACHE_MAX_AGE, "86400");
  process.env.ENABLE_SERVER_COMPRESSION = nonEmpty(process.env.ENABLE_SERVER_COMPRESSION, "true");

  return loaded;
}

function isSensitiveVariable(name: string): boolean {
  const sensitivePatterns = [
    "PASSWORD", "SECRET", "TOKEN", "KEY", "CREDENTIAL",
    "DATABASE_URL", "API_KEY", "AUTH", "PRIVATE", "APIKEY"
  ];
  return sensitivePatterns.some(pattern => name.toUpperCase().includes(pattern));
}

/**
 * Resolves every entry to its final value. A reference sees the value that is actually in effect for the
 * name (real environment first unless `override`), expanded recursively; a self-reference or cycle falls
 * back to the real environment so `PATH=$PATH:/x` appends instead of looping.
 */
function resolveEntries(entries: Map<string, RawEntry>, override: boolean, verbose: boolean): Record<string, string> {
  const resolved = new Map<string, string>();
  const resolving = new Set<string>();

  const lookup = (name: string): string | undefined => {
    const system = process.env[name];
    const entry = entries.get(name);
    if (!entry) return system;
    if (!override && system !== undefined) return system;
    const cached = resolved.get(name);
    if (cached !== undefined) return cached;
    if (resolving.has(name)) return system;

    resolving.add(name);
    const value = entry.expand ? expandVariables(entry.value, lookup, name, verbose) : entry.value;
    resolving.delete(name);
    resolved.set(name, value);
    return value;
  };

  const result: Record<string, string> = {};
  for (const key of entries.keys()) {
    result[key] = lookup(key) ?? "";
  }
  return result;
}

function expandVariables(
  value: string,
  lookup: (name: string) => string | undefined,
  owner: string,
  verbose: boolean
): string {
  return value.replace(
    REFERENCE,
    (match: string, braced: string | undefined, colon: string | undefined, fallback: string | undefined, bare: string | undefined) => {
      if (match === "\\$") return "$";
      const name = braced ?? bare;
      if (name === undefined) return match;

      const found = lookup(name);
      const unset = found === undefined || (colon === ":" && found === "");
      if (fallback !== undefined && unset) return fallback;

      if (found && isSensitiveVariable(name)) {
        logger.warn(`⚠️  [Muraqib Security]: Sensitive environment variable "${name}" was expanded in configuration. Ensure this value is not exposed.`);
      }
      if (found === undefined && verbose) {
        logger.warn(`⚠️  [Muraqib Loader]: "${name}" referenced in ${owner} is not defined; expanded to an empty string. Use single quotes or \\$ for a literal "$".`);
      }
      return found ?? "";
    }
  );
}
