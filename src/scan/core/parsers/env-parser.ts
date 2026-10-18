import * as fs from "node:fs";
import type { parsedLine, syntaxIssue } from "../../types/interface.js";
import { createScanIssue, type ScanIssue, type ScanIssueInput } from "../findings/finding.js";

export interface ParseEnvResult {
  parsedLines: parsedLine[];
  issues: syntaxIssue[];
  parsedData: Record<string, string>;
  findings: ScanIssue[];
}

function stripInlineComment(value: string): string {
  let quote: "'" | '"' | null = null;
  let escaped = false;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (character === "\\" && quote === '"') {
      escaped = true;
      continue;
    }

    if (character === "'" || character === '"') {
      quote = quote === character ? null : quote ?? character;
      continue;
    }

    if (character === "#" && quote === null) {
      return value.slice(0, index).trimEnd();
    }
  }

  return value;
}

/** Index of the first unescaped `quote` in `text`, or -1 (backslash escapes apply to double quotes only). */
function findClosingQuote(text: string, quote: string): number {
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\\" && quote === '"') {
      i++;
    } else if (text[i] === quote) {
      return i;
    }
  }
  return -1;
}

const MAX_MULTILINE_VALUE_LINES = 100;

/**
 * A quoted value that opens on `rawValue` but closes on a later line (for example a PEM private key).
 * Returns the whole quoted text and the index of the line that closes it, or undefined when the
 * value is not a multi-line one (single line, unquoted, or never closed within a sane distance).
 */
function joinMultilineValue(
  lines: string[],
  startIndex: number,
  rawValue: string
): { value: string; lastIndex: number } | undefined {
  const quote = rawValue[0];
  if (quote !== '"' && quote !== "'") return undefined;
  if (findClosingQuote(rawValue.slice(1), quote) >= 0) return undefined;

  let value = rawValue;
  const limit = Math.min(lines.length - 1, startIndex + MAX_MULTILINE_VALUE_LINES);
  for (let next = startIndex + 1; next <= limit; next++) {
    value += `\n${lines[next] ?? ""}`;
    if (findClosingQuote(value.slice(1), quote) >= 0) return { value, lastIndex: next };
  }
  return undefined;
}

/**
 * Parse env file.
 *
 * @param filePath - File path to read
 * @param displayName - Name used in findings (defaults to `filePath`); pass a project-relative name so reports do not embed machine-specific absolute paths
 * @returns Parse env file result
 */
export function parseEnvFile(filePath: string, displayName: string = filePath): ParseEnvResult {
  const parsedLines: parsedLine[] = [];
  const issues: syntaxIssue[] = [];
  const findings: ScanIssueInput[] = [];
  const seenKeys = new Set<string>();
  const parsedData: Record<string, string> = {};

  if (!fs.existsSync(filePath)) {
    throw new Error(`Target file not found at: ${filePath}`);
  }

  const content = fs.readFileSync(filePath, "utf-8");
  const allLines = content.split(/\r?\n/);

  const VALID_LINE_REGEX = /^\s*(?:export\s+)?([a-zA-Z_][\w]*)\s*=\s*(.*)?\s*$/;

  for (let index = 0; index < allLines.length; index++) {
    const lineContent = allLines[index] ?? "";
    const lineNum = index + 1;
    const trimmed = lineContent.trim();

    // 1. Skip empty lines and comments
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    // 2. Check for equals sign separator
    if (!trimmed.includes("=")) {
      const msg = "Malformed line: Missing equals sign (=) separator.";
      issues.push({
        line: lineNum,
        type: "syntax",
        severity: "error",
        message: msg,
      });
      findings.push({
        id: `env-${displayName}-${lineNum}-missing-equals`,
        title: "Missing equals separator",
        message: msg,
        severity: "high",
        category: "validation",
        source: "env-parser",
        file: displayName,
        line: lineNum,
        evidence: "A non-empty environment line is missing an assignment separator.",
        remediation: "Add an '=' between the variable name and value.",
      });
      continue;
    }

    const match = trimmed.match(VALID_LINE_REGEX);

    // 3. Check variable name
    if (!match || !match[1]) {
      const msg = "Invalid Environment Variable name. Keys must start with a letter or underscore and contain only alphanumeric characters.";
      issues.push({
        line: lineNum,
        type: "syntax",
        severity: "error",
        message: msg,
      });
      findings.push({
        id: `env-${displayName}-${lineNum}-invalid-key`,
        title: "Invalid environment variable name",
        message: msg,
        severity: "high",
        category: "validation",
        source: "env-parser",
        file: displayName,
        line: lineNum,
        evidence: "The environment assignment contains an invalid variable name.",
        remediation: "Ensure key starts with a letter or underscore and contains only alphanumeric characters or underscores.",
      });
      continue;
    }

    const key = match[1];
    let rawValue = match[2] ? match[2].trim() : "";

    const multiline = joinMultilineValue(allLines, index, rawValue);
    if (multiline) {
      rawValue = multiline.value;
      index = multiline.lastIndex;
    }

    // Strip comments only when # appears outside quoted values.
    rawValue = stripInlineComment(rawValue).trim();

    const startsWithQuote = rawValue.startsWith('"') || rawValue.startsWith("'");
    const endsWithQuote = rawValue.endsWith('"') || rawValue.endsWith("'");
    const matchesPerfect =
      (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
      (rawValue.startsWith("'") && rawValue.endsWith("'"));

    let finalValue = rawValue;

    // 4. Check quotes
    if (startsWithQuote || endsWithQuote) {
      if (!matchesPerfect) {
        const msg = "Malformed value: Unmatched or missing quotes around the variable value.";
        issues.push({
          line: lineNum,
          type: "syntax",
          severity: "error",
          message: msg,
          key,
        });
        findings.push({
          id: `env-${displayName}-${lineNum}-unmatched-quotes`,
          title: "Unmatched quotes in value",
          message: msg,
          severity: "medium",
          category: "validation",
          source: "env-parser",
          file: displayName,
          line: lineNum,
          key,
          evidence: "The value contains an unmatched quote. The raw value was redacted.",
          remediation: "Wrap the entire value in matching single or double quotes.",
        });
      } else {
        finalValue = rawValue.slice(1, -1).trim();
      }
    } else {
      // 5. Check unquoted spaces
      if (rawValue.includes(" ")) {
        const msg = `Malformed value: Values with spaces must be enclosed in quotes (e.g., KEY="value with spaces").`;
        issues.push({
          line: lineNum,
          type: "syntax",
          severity: "error",
          message: msg,
          key,
        });
        findings.push({
          id: `env-${displayName}-${lineNum}-unquoted-spaces`,
          title: "Unquoted value containing spaces",
          message: msg,
          severity: "medium",
          category: "validation",
          source: "env-parser",
          file: displayName,
          line: lineNum,
          key,
          evidence: "The value contains unquoted whitespace. The raw value was redacted.",
          remediation: `Wrap the value assigned to ${key} in matching quotes.`,
        });
      }
    }

    // 6. Check duplicate keys
    if (seenKeys.has(key)) {
      const msg = `Duplicate key detected: "${key}" is defined multiple times. Subsequent values will overwrite it.`;
      issues.push({
        line: lineNum,
        type: "syntax",
        severity: "warning",
        message: msg,
        key,
      });
      findings.push({
        id: `env-${displayName}-${lineNum}-duplicate-key`,
        title: "Duplicate environment key",
        message: msg,
        severity: "low",
        category: "configuration",
        source: "env-parser",
        file: displayName,
        line: lineNum,
        key,
        remediation: "Remove or consolidate the duplicate key definition.",
      });
    } else {
      seenKeys.add(key);
    }

    parsedLines.push({
      line: lineNum,
      key,
      value: finalValue,
    });

    parsedData[key] = finalValue;
  }

  return { parsedLines, issues, parsedData, findings: findings.map(createScanIssue) };
}
