import { describe, expect, test } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * The engine layers must stay free of CLI/terminal-UI code so other front-ends
 * (a VS Code extension, an MCP server) can reuse them.
 */
const ROOT = join(process.cwd(), "src");
const ENGINE_DIRS = ["core", "rules", "guard", "agent", "env", "ai", "config"];
const ENGINE_FILES = ["orchestrator/collect-results.ts"];
const FORBIDDEN = [/from\s+["'][^"']*\/cli\//, /from\s+["']@clack\//, /process\.exit\s*\(/];

function listTs(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return listTs(full);
    return name.endsWith(".ts") && !name.endsWith(".spec.ts") ? [full] : [];
  });
}

describe("engine layers are independent of the CLI", () => {
  const files = [
    ...ENGINE_DIRS.flatMap((d) => {
      try {
        return listTs(join(ROOT, d));
      } catch {
        return [];
      }
    }),
    ...ENGINE_FILES.map((f) => join(ROOT, f)),
  ];

  test("covers a meaningful number of files", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  test.each(FORBIDDEN.map((re) => [String(re), re] as const))("no file matches %s", (_label, re) => {
    const offenders = files.filter((f) => re.test(readFileSync(f, "utf8"))).map((f) => relative(ROOT, f));
    expect(offenders).toEqual([]);
  });
});
