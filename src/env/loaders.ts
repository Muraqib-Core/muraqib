import fs from "fs";
import path from "path";

export interface LoadEnvOptions {
  cwd?: string;
  files?: string[];
  preserveProcessEnv?: boolean;
  verbose?: boolean;
}

export function loadEnv(options: LoadEnvOptions = {}): Record<string, string> {
  const cwd = options.cwd ?? process.cwd();
  const nodeEnv = process.env.NODE_ENV ?? "development";
  const files = options.files ?? [".env", `.env.${nodeEnv}`, ".env.local"];
  const loaded: Record<string, string> = {};

  for (const file of files) {
    const filePath = path.join(cwd, file);
    if (!fs.existsSync(filePath)) continue;

    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const lines = content.split(/\r?\n/);
      let pendingKey: string | null = null;
      let pendingValue = "";

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        const trimmed = line.trim();

        if (!trimmed || trimmed.startsWith("#")) continue;

        if (pendingKey !== null) {
          pendingValue += "\n" + line.replace(/\\$/, "").trimEnd();
          if (!line.endsWith("\\")) {
            loaded[pendingKey] = pendingValue;
            if (options.verbose) {
              console.log(`📄 [Muraqib Loader]: Loaded ${pendingKey} from ${file}`);
            }
            pendingKey = null;
          }
          continue;
        }

        const commentIndex = findCommentIndex(trimmed);
        const meaningful = commentIndex >= 0 ? trimmed.slice(0, commentIndex) : trimmed;
        const withoutExport = meaningful.replace(/^export\s+/, "").trim();
        const eqIndex = withoutExport.indexOf("=");
        if (eqIndex < 0) continue;

        const key = withoutExport.slice(0, eqIndex).trim();
        let rawValue = withoutExport.slice(eqIndex + 1).trim();

        const quoteMatch = rawValue.match(/^(['"])(.*)\1$/s);
        if (quoteMatch) {
          rawValue = quoteMatch[2] ?? rawValue;
        }

        pendingKey = key;
        pendingValue = rawValue;

        if (!line.endsWith("\\")) {
          loaded[key] = rawValue;
          if (options.verbose) {
            console.log(`📄 [Muraqib Loader]: Loaded ${key} from ${file}`);
          }
          pendingKey = null;
        }
      }

      if (pendingKey !== null) {
        loaded[pendingKey] = pendingValue;
        if (options.verbose) {
          console.log(`📄 [Muraqib Loader]: Loaded ${pendingKey} from ${file}`);
        }
      }
    } catch {
      console.warn(`⚠️ [Muraqib Loader]: Failed to load ${filePath}`);
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

  process.env.PORT = process.env.PORT || "3000";
  process.env.STATIC_ASSETS_CACHE_MAX_AGE = process.env.STATIC_ASSETS_CACHE_MAX_AGE || "86400";
  process.env.ENABLE_SERVER_COMPRESSION = process.env.ENABLE_SERVER_COMPRESSION || "true";

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
      console.warn(`⚠️  [Muraqib Security]: Sensitive environment variable "${name}" was expanded in configuration. Ensure this value is not exposed.`);
    }
    return expanded ?? def ?? "";
  });
}
