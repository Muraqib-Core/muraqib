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

/** What to emit for the text starting at an index outside any string, and the last index it consumed. */
interface ScanStep {
  emit: string;
  last: number;
}

/**
 * Copies `text`, passing string literals (with escapes) through untouched and letting `step`
 * decide what each character outside a string becomes.
 */
function scanOutsideStrings(text: string, step: (text: string, index: number) => ScanStep): string {
  let out = "";
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] ?? "";

    if (inString) {
      out += ch;
      if (ch === "\\") {
        out += text[i + 1] ?? "";
        i++;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    const result = step(text, i);
    out += result.emit;
    i = result.last;
  }
  return out;
}

/** Drops `//` and block comments; a line comment keeps its newline. */
function dropComment(text: string, i: number): ScanStep {
  const ch = text[i] ?? "";
  const next = text[i + 1] ?? "";
  if (ch === "/" && next === "/") {
    let end = i;
    while (end < text.length && text[end] !== "\n") end++;
    return { emit: "\n", last: end };
  }
  if (ch === "/" && next === "*") {
    let end = i + 2;
    while (end < text.length && !(text[end] === "*" && text[end + 1] === "/")) end++;
    return { emit: "", last: end + 1 };
  }
  return { emit: ch, last: i };
}

/** Drops a comma whose next non-whitespace character closes an object or array. */
function dropTrailingComma(text: string, i: number): ScanStep {
  const ch = text[i] ?? "";
  if (ch !== ",") return { emit: ch, last: i };
  let j = i + 1;
  while (j < text.length && /\s/.test(text[j] ?? "")) j++;
  const following = text[j];
  return { emit: following === "}" || following === "]" ? "" : ch, last: i };
}

function stripJsonCommentsAndTrailingCommas(input: string): string {
  // Remove UTF-8 BOM if present
  const text = input.startsWith('﻿') ? input.slice(1) : input;
  return scanOutsideStrings(scanOutsideStrings(text, dropComment), dropTrailingComma);
}

function parseJsonc(input: string): unknown {
  return JSON.parse(stripJsonCommentsAndTrailingCommas(input));
}

/**
 * Read compiler options.
 *
 * @param configPath - Config path
 * @param depth - Depth
 * @returns Read compiler options result
 */
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
