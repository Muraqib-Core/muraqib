import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigGuard, performConfigAudit } from "./config-guard.js";

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

  it("maps issues through ConfigGuard", async () => {
    writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: { noImplicitAny: false } }));
    const result = await new ConfigGuard({ projectRoot: dir }).run();
    expect(result.issues.some((i) => i.code === "CONFIG_UNSAFE_SETTING")).toBe(true);
  });
});
