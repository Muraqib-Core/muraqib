/**
 * TypeScript config parsing with JSON with comments support.
 * Extracted to reduce config-guard.ts bundle size.
 */

import fs from "fs";
import path from "path";

const MAX_TSCONFIG_EXTENDS_DEPTH = 5;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stripJsonCommentsAndTrailingCommas(input: string): string {
  // Remove UTF-8 BOM if present
  const text = input.startsWith('﻿') ? input.slice(1) : input;

  let noComments = "";
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] ?? "";
    const next = text[i + 1] ?? "";

    if (inString) {
      noComments += ch;
      if (ch === "\\") {
        noComments += next;
        i++;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      noComments += ch;
    } else if (ch === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      noComments += "\n";
    } else if (ch === "/" && next === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i++;
    } else {
      noComments += ch;
    }
  }

  let result = "";
  inString = false;
  for (let i = 0; i < noComments.length; i++) {
    const ch = noComments[i] ?? "";

    if (inString) {
      result += ch;
      if (ch === "\\") {
        result += noComments[i + 1] ?? "";
        i++;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      result += ch;
    } else if (ch === ",") {
      let j = i + 1;
      while (j < noComments.length && /\s/.test(noComments[j] ?? "")) j++;
      const following = noComments[j];
      if (following !== "}" && following !== "]") result += ch;
    } else {
      result += ch;
    }
  }

  return result;
}

function parseJsonc(input: string): unknown {
  return JSON.parse(stripJsonCommentsAndTrailingCommas(input));
}

export function readCompilerOptions(configPath: string, depth = 0): Record<string, unknown> | undefined {
  const parsed = parseJsonc(fs.readFileSync(configPath, "utf-8"));
  const config = isRecord(parsed) ? parsed : {};
  let merged: Record<string, unknown> | undefined;

  if (depth < MAX_TSCONFIG_EXTENDS_DEPTH) {
    const extendsValue = config.extends;
    const parents = typeof extendsValue === "string" ? [extendsValue] : Array.isArray(extendsValue) ? extendsValue : [];
    for (const parent of parents) {
      if (typeof parent !== "string" || !parent.startsWith(".")) continue;
      let parentPath = path.resolve(path.dirname(configPath), parent);
      if (!fs.existsSync(parentPath) && fs.existsSync(`${parentPath}.json`)) parentPath = `${parentPath}.json`;
      if (!fs.existsSync(parentPath)) continue;
      try {
        const parentOptions = readCompilerOptions(parentPath, depth + 1);
        if (parentOptions) merged = { ...(merged ?? {}), ...parentOptions };
      } catch {
        // skip unreadable parent
      }
    }
  }

  if (isRecord(config.compilerOptions)) {
    merged = { ...(merged ?? {}), ...config.compilerOptions };
  }
  return merged;
}
