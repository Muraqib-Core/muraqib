import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigGuard, performConfigAudit } from "./config-guard.js";
import { runGit } from "./helpers/git-protection.js";

describe("ConfigGuard tsconfig handling (tsconfig-parser)", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "muraqib-cfg-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("accepts a JSONC tsconfig with comments and trailing commas", () => {
    writeFileSync(
      join(dir, "tsconfig.json"),
      '{\n // strict\n "compilerOptions": { "strict": true, },\n}\n'
    );
    const result = performConfigAudit(dir);
    expect(result.issues.filter((i) => i.file === "tsconfig.json")).toEqual([]);
  });

  it("honours strict inherited through a relative extends", () => {
    writeFileSync(join(dir, "base.json"), JSON.stringify({ compilerOptions: { strict: true } }));
    writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ extends: "./base.json" }));
    const result = performConfigAudit(dir);
    expect(result.issues.filter((i) => i.file === "tsconfig.json")).toEqual([]);
  });

  it("still reports strict mode disabled when nothing enables it", () => {
    writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: {} }));
    const result = performConfigAudit(dir);
    expect(result.issues.some((i) => i.setting === "strict")).toBe(true);
  });

  it("reports a malformed tsconfig as invalid_json", () => {
    writeFileSync(join(dir, "tsconfig.json"), "{ nope");
    const result = performConfigAudit(dir);
    expect(result.issues.some((i) => i.type === "invalid_json" && i.file === "tsconfig.json")).toBe(true);
  });

  describe("tracked environment files (git-protection)", () => {
    it("flags tracked env files but not templates or untracked ones", () => {
      expect(runGit(["init", "-q"], dir).status).toBe(0);
      writeFileSync(join(dir, ".env"), "A=1\n");
      writeFileSync(join(dir, ".env.example"), "A=\n");
      writeFileSync(join(dir, ".env.local"), "A=1\n");
      expect(runGit(["add", ".env", ".env.example"], dir).status).toBe(0);
      const tracked = performConfigAudit(dir).issues.filter((i) => i.type === "tracked_env_file");
      expect(tracked.map((i) => i.file)).toEqual([".env"]);
      expect(tracked[0]?.severity).toBe("high");
    });

    it("ignores tracked env files that define no variables or are missing on disk", () => {
      expect(runGit(["init", "-q"], dir).status).toBe(0);
      writeFileSync(join(dir, ".env"), "# nothing here\n");
      writeFileSync(join(dir, ".env.gone"), "A=1\n");
      expect(runGit(["add", ".env", ".env.gone"], dir).status).toBe(0);
      rmSync(join(dir, ".env.gone"));
      expect(performConfigAudit(dir).issues.some((i) => i.type === "tracked_env_file")).toBe(false);
    });

    it("mentions the variable count in the message", () => {
      expect(runGit(["init", "-q"], dir).status).toBe(0);
      writeFileSync(join(dir, ".env"), "A=1\nB=2\n");
      expect(runGit(["add", ".env"], dir).status).toBe(0);
      const issue = performConfigAudit(dir).issues.find((i) => i.type === "tracked_env_file");
      expect(issue?.message).toContain("2 variable(s)");
    });

    it("reports nothing outside a repository", () => {
      writeFileSync(join(dir, ".env"), "A=1\n");
      expect(performConfigAudit(dir).issues.some((i) => i.type === "tracked_env_file")).toBe(false);
    });

    it("surfaces as an error-level CONFIG_TRACKED_ENV_FILE issue", async () => {
      expect(runGit(["init", "-q"], dir).status).toBe(0);
      writeFileSync(join(dir, ".env"), "A=1\n");
      expect(runGit(["add", ".env"], dir).status).toBe(0);
      const result = await new ConfigGuard({ projectRoot: dir }).run();
      const issue = result.issues.find((i) => i.code === "CONFIG_TRACKED_ENV_FILE");
      expect(issue?.severity).toBe("error");
    });
  });

  it("maps issues through ConfigGuard", async () => {
    writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: { noImplicitAny: false } }));
    const result = await new ConfigGuard({ projectRoot: dir }).run();
    expect(result.issues.some((i) => i.code === "CONFIG_UNSAFE_SETTING")).toBe(true);
  });
});
