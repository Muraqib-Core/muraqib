/**
 * Environment file parsing helpers.
 * Extracted to reduce config-guard.ts bundle size.
 */

export interface EnvEntry {
  key: string;
  value: string;
}

function findClosingQuote(text: string, quote: string): number {
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\\" && quote !== "'") {
      i++;
      continue;
    }
    if (ch === quote) return i;
  }
  return -1;
}

export function parseEnvEntries(content: string): EnvEntry[] {
  const entries: EnvEntry[] = [];
  const lines = content.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const trimmed = (lines[i] ?? "").trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;

    const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.*)$/);
    const key = match?.[1];
    if (!key) continue;
    const rest = match?.[2] ?? "";

    const quote = rest[0];
    if (quote === '"' || quote === "'" || quote === "`") {
      let body = rest.slice(1);
      let closing = findClosingQuote(body, quote);
      let lastLine = i;
      while (closing < 0 && lastLine + 1 < lines.length && lastLine - i < 100) {
        lastLine++;
        body += `\n${lines[lastLine] ?? ""}`;
        closing = findClosingQuote(body, quote);
      }
      if (closing >= 0) {
        entries.push({ key, value: body.slice(0, closing) });
        i = lastLine;
      } else {
        entries.push({ key, value: rest.slice(1) });
      }
      continue;
    }

    entries.push({ key, value: rest.replace(/\s+#.*$/, "").trim() });
  }

  return entries;
}
