import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { DEFAULT_FIXERS } from "../../../../../src/agent-v2/fix/registry.js";
import { runFixSession } from "../../../../../src/agent-v2/fix/session.js";

const SECRET = ["sk", "live", "A1b2C3d4E5f6G7h8I9j0K1l2"].join("_");
let root: string;

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function git(...args: string[]): void {
  execFileSync("git", args, { cwd: root, stdio: "ignore" });
}

describe("propose mode checks the real project's git history", () => {
  test("a committed secret is reported as being in history even though the work copy has no .git", async () => {
    root = mkdtempSync(join(tmpdir(), "agent-v2-history-"));
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "package.json"), '{"name":"x","version":"1.0.0"}\n');
    writeFileSync(join(root, "src", "pay.ts"), `export const stripeKey = "${SECRET}";\n`);
    git("init", "-q");
    git("config", "user.name", "Test");
    git("config", "user.email", "test@example.com");
    git("add", ".");
    git("commit", "-q", "-m", "init");

    const result = await runFixSession({ projectRoot: root, mode: "propose", fixers: DEFAULT_FIXERS });
    const secretFix = result.outcomes.find((o) => o.fix.removesSecret);
    expect(secretFix?.status).toBe("verified");
    expect(secretFix?.fix.warnings.some((w) => w.includes("exists in git history"))).toBe(true);
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(result.patch).not.toContain(SECRET);
  });
});
