import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { runAgentCli } from "../../../../src/agent-v2/cli.js";
import { CACHE_DIR_ENV } from "../../../../src/agent-v2/explain/config.js";
import { generateDemoFixture, removeProject } from "../support.js";

let project: string;
let cacheDir: string;
let saved: Record<string, string | undefined>;
let out: string[];
let err: string[];

beforeEach(() => {
  saved = {
    g: process.env.GEMINI_API_KEY,
    k: process.env.GOOGLE_API_KEY,
    c: process.env[CACHE_DIR_ENV],
  };
  delete process.env.GEMINI_API_KEY;
  delete process.env.GOOGLE_API_KEY;
  cacheDir = mkdtempSync(join(tmpdir(), "agent-v2-cli-cache-"));
  process.env[CACHE_DIR_ENV] = cacheDir;
  project = generateDemoFixture();
  out = [];
  err = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
    out.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
    err.push(String(chunk));
    return true;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  const restore = (name: string, v: string | undefined): void => {
    if (v === undefined) delete process.env[name];
    else process.env[name] = v;
  };
  restore("GEMINI_API_KEY", saved.g);
  restore("GOOGLE_API_KEY", saved.k);
  restore(CACHE_DIR_ENV, saved.c);
  removeProject(project);
  rmSync(cacheDir, { recursive: true, force: true });
});

const stepLines = (text: string): string[] => text.split("\n").filter((l) => /^\d+\. \[/.test(l));

describe("runAgentCli --explain", () => {
  test("no key: exit 0, fallback footer, step order unchanged", async () => {
    const plainCode = await runAgentCli(["plan", "--project", project]);
    const plain = out.join("");
    out.length = 0;
    const code = await runAgentCli(["plan", "--project", project, "--explain"]);
    const explained = out.join("");

    expect(plainCode).toBe(0);
    expect(code).toBe(0);
    expect(explained).toContain("Explanations: fallback");
    expect(explained).toContain("explain:");
    expect(stepLines(plain).length).toBeGreaterThan(0);
    expect(stepLines(explained)).toEqual(stepLines(plain));
    expect(plain).not.toContain("Explanations:");
  });

  test("--lang ar prints Arabic explanations", async () => {
    const code = await runAgentCli(["plan", "--project", project, "--explain", "--lang", "ar"]);
    expect(code).toBe(0);
    expect(out.join("")).toMatch(/explain: .*[؀-ۿ]/);
  });

  test("--json includes the explainer block", async () => {
    const code = await runAgentCli(["plan", "--project", project, "--explain", "--json"]);
    expect(code).toBe(0);
    const parsed = JSON.parse(out.join("")) as { explainer?: { mode: string; calls: number } };
    expect(parsed.explainer).toMatchObject({ mode: "fallback", calls: 0 });
  });

  test("--explain-top limits explained steps", async () => {
    await runAgentCli(["plan", "--project", project, "--explain", "--explain-top", "1"]);
    const text = out.join("");
    expect(stepLines(text).length).toBeGreaterThan(1);
    expect((text.match(/explain:/g) ?? []).length).toBe(1);
  });

  test("invalid --lang exits 2", async () => {
    const code = await runAgentCli(["plan", "--project", project, "--explain", "--lang", "fr"]);
    expect(code).toBe(2);
    expect(err.join("")).toContain("--lang must be ar or en");
  });

  test("invalid --explain-top exits 2", async () => {
    expect(await runAgentCli(["plan", "--project", project, "--explain-top", "-1"])).toBe(2);
    expect(await runAgentCli(["plan", "--project", project, "--explain-top", "abc"])).toBe(2);
  });
});
