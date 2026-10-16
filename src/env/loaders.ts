import fs from "fs";
import path from "path";
import * as logger from "../shared/logger.js";
import { nonEmpty } from "../utils/defaults.js";

export interface LoadEnvOptions {
  cwd?: string;
  files?: string[];
  preserveProcessEnv?: boolean;
  verbose?: boolean;
}

/** Parses a trimmed `KEY=value` line (optional `export`, trailing comment, surrounding quotes), or undefined. */
function parseAssignment(trimmed: string): { key: string; value: string } | undefined {
  const commentIndex = findCommentIndex(trimmed);
  const meaningful = commentIndex >= 0 ? trimmed.slice(0, commentIndex) : trimmed;
  const withoutExport = meaningful.replace(/^export\s+/, "").trim();
  const eqIndex = withoutExport.indexOf("=");
  if (eqIndex < 0) return undefined;

  const key = withoutExport.slice(0, eqIndex).trim();
  const rawValue = withoutExport.slice(eqIndex + 1).trim();
  const quoteMatch = rawValue.match(/^(['"])(.*)\1$/s);
  return { key, value: quoteMatch ? (quoteMatch[2] ?? rawValue) : rawValue };
}

/**
 * Parses one file's content into `loaded`. A line ending in a backslash continues onto the next
 * one; blank lines and comments are skipped even inside a continuation.
 */
function parseEnvContent(content: string, file: string, loaded: Record<string, string>, verbose: boolean): void {
  const record = (key: string, value: string): void => {
    loaded[key] = value;
    if (verbose) {
      logger.log(`📄 [Muraqib Loader]: Loaded ${key} from ${file}`);
    }
  };

  let pending: { key: string; value: string } | null = null;
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const continues = line.endsWith("\\");
    if (pending !== null) {
      pending.value += "\n" + line.replace(/\\$/, "").trimEnd();
      if (!continues) {
        record(pending.key, pending.value);
        pending = null;
      }
      continue;
    }

    const assignment = parseAssignment(trimmed);
    if (!assignment) continue;
    if (continues) pending = assignment;
    else record(assignment.key, assignment.value);
  }

  if (pending !== null) record(pending.key, pending.value);
}

/**
 * Load env.
 *
 * @param options - Options
 * @returns Load env result
 */
export function loadEnv(options: LoadEnvOptions = {}): Record<string, string> {
  const cwd = options.cwd ?? process.cwd();
  const nodeEnv = process.env.NODE_ENV ?? "development";
  const files = options.files ?? [".env", `.env.${nodeEnv}`, ".env.local"];
  const loaded: Record<string, string> = {};

  for (const file of files) {
    const filePath = path.join(cwd, file);
    if (!fs.existsSync(filePath)) continue;

    try {
      parseEnvContent(fs.readFileSync(filePath, "utf-8"), file, loaded, Boolean(options.verbose));
    } catch {
      logger.warn(`⚠️ [Muraqib Loader]: Failed to load ${filePath}`);
    }
  }

  for (const key of Object.keys(loaded)) {
    loaded[key] = expandVariables(loaded[key]!, { ...process.env, ...loaded });
  }

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

function findCommentIndex(str: string): number {
  let inQuotes: string | null = null;
  let escaped = false;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"' || ch === "'") {
      if (inQuotes === ch) inQuotes = null;
      else if (!inQuotes) inQuotes = ch;
    } else if (ch === "#" && !inQuotes) {
      return i;
    }
  }
  return -1;
}

function isSensitiveVariable(name: string): boolean {
  const sensitivePatterns = [
    'PASSWORD', 'SECRET', 'TOKEN', 'KEY', 'CREDENTIAL',
    'DATABASE_URL', 'API_KEY', 'AUTH', 'PRIVATE', 'APIKEY'
  ];
  return sensitivePatterns.some(pattern => name.toUpperCase().includes(pattern));
}

function expandVariables(value: string, env: Record<string, string | undefined>): string {
  return value.replace(/\$\{?([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}?/g, (_, name, def) => {
    const expanded = env[name];
    if (expanded && isSensitiveVariable(name)) {
      logger.warn(`⚠️  [Muraqib Security]: Sensitive environment variable "${name}" was expanded in configuration. Ensure this value is not exposed.`);
    }
    return expanded ?? def ?? "";
  });
}
