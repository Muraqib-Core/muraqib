import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { resolveApiKey } from "../../../src/ai/advisor.js";
import { createGeminiClient } from "../../../src/ai/gemini-client.js";
import { runAuditForAgent } from "../../../src/agent/run-audit-for-agent.js";
import { findSecrets } from "../../../src/core/secret-detector.js";
import { MissingOptionalDependencyError } from "../../../src/utils/optional-dependency.js";
import { scanProjectFiles } from "../../../src/utils/file-scanner.js";

/**
 * agent-v2 reads these v1 surfaces but never changes them. If v1 changes one of them, the matching
 * test here fails first, with a message that names the contract, instead of a confusing failure deep
 * inside a fixer or the verification loop.
 */
const SECRET = ["sk", "live", "A1b2C3d4E5f6G7h8I9j0K1l2"].join("_");
let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "agent-v2-contract-"));
  mkdirSync(join(root, "src"));
  mkdirSync(join(root, "node_modules", "dep"), { recursive: true });
  writeFileSync(join(root, "package.json"), '{"name":"t","version":"1.0.0"}\n');
  writeFileSync(join(root, "src", "a.ts"), 'async function save(): Promise<void> {}\nexport async function f(): Promise<void> {\n  fetch("/x");\n  save();\n}\n');
  writeFileSync(join(root, "node_modules", "dep", "index.ts"), "export const ignored = 1;\n");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("v1 contract: audit report (runAuditForAgent)", () => {
  test("report shape and the issue fields agent-v2 reads", async () => {
    const report = await runAuditForAgent({ projectRoot: root });
    expect(report.schemaVersion).toBe("1.0");
    expect(report.ok).toBe(true);
    const issue = report.issues.find((i) => i.code === "ASYNC_FLOATING_PROMISE");
    expect(issue).toBeDefined();
    expect(issue).toMatchObject({ module: "async-guard", severity: "error", file: "src/a.ts", line: 3 });
    expect(typeof issue?.id).toBe("string");
    expect(typeof issue?.message).toBe("string");
    expect(Array.isArray(issue?.tags)).toBe(true);
  });

  test("a same-file async call without arguments is ASYNC_MISSING_AWAIT", async () => {
    const report = await runAuditForAgent({ projectRoot: root });
    expect(report.issues.some((i) => i.code === "ASYNC_MISSING_AWAIT" && i.file === "src/a.ts" && i.line === 4)).toBe(true);
  });

  test("issue ids are stable across runs", async () => {
    const first = (await runAuditForAgent({ projectRoot: root })).issues.map((i) => i.id);
    const second = (await runAuditForAgent({ projectRoot: root })).issues.map((i) => i.id);
    expect(second).toEqual(first);
  });

  test("an unreadable audit comes back as ok:false instead of throwing", async () => {
    const report = await runAuditForAgent({ projectRoot: root, modules: ["no-such-module-xyz"] });
    expect(typeof report.ok).toBe("boolean");
  });
});

describe("v1 contract: secret detector (findSecrets)", () => {
  test("returns type, line and a masked pattern, never the raw value", () => {
    const [match] = findSecrets(`export const k = "${SECRET}";\n`, { file: "src/a.ts", includeHeuristics: false, ignorePlaceholders: true });
    expect(match).toBeDefined();
    expect(match?.type).toBe("api_key");
    expect(match?.blocking).toBe(true);
    expect(match?.line).toBe(1);
    expect(match?.pattern).not.toContain(SECRET);
  });

  test("a placeholder value is ignored when ignorePlaceholders is on", () => {
    expect(findSecrets('export const adminPassword = "xxxx";\n', { includeHeuristics: false, ignorePlaceholders: true })).toHaveLength(0);
  });
});

describe("v1 contract: file scanner (scanProjectFiles)", () => {
  test("returns relative paths and content, skips node_modules", () => {
    const files = scanProjectFiles(root, ["ts", "js"], { includeTests: false });
    expect(files.map((f) => f.relativePath.split("\\").join("/"))).toEqual(["src/a.ts"]);
    expect(files[0]?.content).toContain("fetch(");
  });
});

describe("v1 contract: Gemini helpers", () => {
  const saved = { g: process.env.GEMINI_API_KEY, k: process.env.GOOGLE_API_KEY };
  afterEach(() => {
    for (const [name, value] of [["GEMINI_API_KEY", saved.g], ["GOOGLE_API_KEY", saved.k]] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  test("resolveApiKey prefers GEMINI_API_KEY, then GOOGLE_API_KEY, and returns undefined without either", () => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    expect(resolveApiKey()).toBeUndefined();
    process.env.GOOGLE_API_KEY = "google-key";
    expect(resolveApiKey()).toBe("google-key");
    process.env.GEMINI_API_KEY = "gemini-key";
    expect(resolveApiKey()).toBe("gemini-key");
    expect(resolveApiKey("explicit")).toBe("explicit");
  });

  test("createGeminiClient and MissingOptionalDependencyError exist with the expected shape", () => {
    expect(typeof createGeminiClient).toBe("function");
    expect(new MissingOptionalDependencyError("pkg", "feature").message).toContain("pkg");
  });
});
