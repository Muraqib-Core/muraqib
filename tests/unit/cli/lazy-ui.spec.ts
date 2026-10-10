import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("library entry stays light", () => {
  test("cli/index.ts loads the Clack UI lazily", () => {
    const src = readFileSync(join(process.cwd(), "src/cli/index.ts"), "utf8");
    expect(src).not.toMatch(/from\s+["']\.\/interactive\.js["']/);
    expect(src).toMatch(/import\(["']\.\/interactive\.js["']\)/);
  });
});
