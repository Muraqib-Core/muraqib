import * as fs from "node:fs";
import type { parsedLine, syntaxIssue } from "../../types/interface.js";
import type { Finding } from "../findings/finding.js";

export interface ParseEnvResult {
  parsedLines: parsedLine[];
  issues: syntaxIssue[];
  parsedData: Record<string, string>;
  findings: Finding[];
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

export function parseEnvFile(filePath: string): ParseEnvResult {
  const parsedLines: parsedLine[] = [];
  const issues: syntaxIssue[] = [];
  const findings: Finding[] = [];
  const seenKeys = new Set<string>();
  const parsedData: Record<string, string> = {};

  if (!fs.existsSync(filePath)) {
    throw new Error(`Target file not found at: ${filePath}`);
  }

  const content = fs.readFileSync(filePath, "utf-8");
  const allLines = content.split("\n");

  const VALID_LINE_REGEX = /^\s*([a-zA-Z_][\w]*)\s*=\s*(.*)?\s*$/;

  allLines.forEach((lineContent, index) => {
    const lineNum = index + 1;
    const trimmed = lineContent.trim();

    // 1. Skip empty lines and comments
    if (!trimmed || trimmed.startsWith("#")) {
      return;
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
        id: `env-${filePath}-${lineNum}-missing-equals`,
        title: "Missing equals separator",
        message: msg,
        severity: "high",
        category: "validation",
        source: "env-parser",
        file: filePath,
        line: lineNum,
        evidence: "A non-empty environment line is missing an assignment separator.",
        remediation: "Add an '=' between the variable name and value.",
      });
      return;
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
        id: `env-${filePath}-${lineNum}-invalid-key`,
        title: "Invalid environment variable name",
        message: msg,
        severity: "high",
        category: "validation",
        source: "env-parser",
        file: filePath,
        line: lineNum,
        evidence: "The environment assignment contains an invalid variable name.",
        remediation: "Ensure key starts with a letter or underscore and contains only alphanumeric characters or underscores.",
      });
      return;
    }

    const key = match[1];
    let rawValue = match[2] ? match[2].trim() : "";

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
          id: `env-${filePath}-${lineNum}-unmatched-quotes`,
          title: "Unmatched quotes in value",
          message: msg,
          severity: "medium",
          category: "validation",
          source: "env-parser",
          file: filePath,
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
          id: `env-${filePath}-${lineNum}-unquoted-spaces`,
          title: "Unquoted value containing spaces",
          message: msg,
          severity: "medium",
          category: "validation",
          source: "env-parser",
          file: filePath,
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
        id: `env-${filePath}-${lineNum}-duplicate-key`,
        title: "Duplicate environment key",
        message: msg,
        severity: "low",
        category: "configuration",
        source: "env-parser",
        file: filePath,
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
  });

  return { parsedLines, issues, parsedData, findings };
}
