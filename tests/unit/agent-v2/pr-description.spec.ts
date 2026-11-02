import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { buildPrDescription, formatPrDescription } from "../../../src/agent-v2/pr-description.js";
import { runPrDescriptionCli } from "../../../src/agent-v2/pr-description-cli.js";
import type { FixOutcome, FixSessionResult } from "../../../src/agent-v2/fix/session.js";
import type { ProposedFix } from "../../../src/agent-v2/fix/types.js";
import { AGENT_PLAN_SCHEMA_VERSION, type AgentPlan, type FixClass, type PlanStep } from "../../../src/agent-v2/types.js";

const SECRET = ["sk", "live", "A1b2C3d4E5f6G7h8I9j0K1l2"].join("_");

function step(n: number, fixClass: FixClass, file = `src/f${n}.ts`): PlanStep {
  return { rank: n, issueId: `id${n}`, module: "m", code: `C${n}`, severity: "error", title: `Title ${n}`, fixClass, autoFixable: fixClass !== "manual", file, line: n, reasons: [] };
}

function plan(steps: PlanStep[], overrides: Partial<AgentPlan> = {}): AgentPlan {
  const manual = steps.filter((s) => s.fixClass === "manual").length;
  return {
    schemaVersion: AGENT_PLAN_SCHEMA_VERSION,
    projectRoot: "/p",
    verdict: "fail",
    ok: true,
    summary: { total: steps.length, autoFixable: steps.length - manual, manual, byFixClass: { "floating-promise": 0, "hardcoded-secret": 0, "env-documentation": 0, manual } },
    steps,
    ...overrides,
  };
}

function fix(fixClass: FixClass, title: string, removesSecret = false): ProposedFix {
  return { id: `${fixClass}|${title}`, fixClass, title, resolves: [], edits: [{ file: "src/a.ts", content: "x" }], warnings: removesSecret ? ["Rotate this credential"] : [], removesSecret };
}

function result(outcomes: FixOutcome[], extra: Partial<FixSessionResult> = {}): FixSessionResult {
  return { ok: true, mode: "propose", outcomes, decisions: [], skipped: [], patch: "", issuesBefore: 5, issuesAfter: 2, ...extra };
}

describe("formatPrDescription", () => {
  test("describes concrete issues, fixes and verification counts", () => {
    const p = plan([step(1, "floating-promise"), step(2, "hardcoded-secret"), step(3, "env-documentation"), step(4, "manual")]);
    const r = result(
      [
        { fix: fix("floating-promise", "Add await to fetch() in src/f1.ts:1"), status: "verified" },
        { fix: fix("hardcoded-secret", "Move secret in src/f2.ts:2 to process.env.KEY", true), status: "verified" },
        { fix: fix("env-documentation", "Create .env.example"), status: "rejected", note: "the fix introduces new issues" },
      ],
      { decisions: [{ issueId: "idx", question: "Which?", options: [{ key: "async", label: "a" }, { key: "catch", label: "c" }] }], skipped: [{ issueId: "idy", reason: "two literals" }] }
    );
    const out = formatPrDescription(p, r);
    expect(out.title).toBe("fix: await 1 floating promise, move 1 secret to env");
    expect(out.body).toContain("src/f1.ts:1");
    expect(out.body).toContain("value not shown");
    expect(out.body).toContain("1 other issue that need");
    expect(out.body).toContain("kept out of the patch file");
    expect(out.body).toContain("WARNING: Rotate this credential");
    expect(out.body).toContain("Not applied: Create .env.example - the fix introduces new issues");
    expect(out.body).toContain("Waiting for a decision on idx");
    expect(out.body).toContain("Skipped idy: two literals");
    expect(out.body).toContain("2 accepted, 1 rejected");
    expect(out.body).toContain("5 before, 2 after");
    expect(out.body).toContain("secret fixes are not applied in propose mode");
    expect(out.body).toContain("Not covered by this tool");
  });

  test("never claims fixes when none passed verification", () => {
    const out = formatPrDescription(plan([step(1, "floating-promise")]), result([{ fix: fix("floating-promise", "t"), status: "rejected", note: "still reported" }]));
    expect(out.title).toBe("fix: no verified fixes (nothing to merge)");
    expect(out.body).toContain("No fix passed verification");
  });

  test("no issues and singular/plural wording", () => {
    expect(formatPrDescription(plan([]), result([])).body).toContain("The audit reports no issues.");
    const out = formatPrDescription(
      plan([step(1, "floating-promise"), step(2, "floating-promise")]),
      result([
        { fix: fix("floating-promise", "a"), status: "applied" },
        { fix: fix("floating-promise", "b"), status: "applied" },
      ])
    );
    expect(out.title).toBe("fix: await 2 floating promises");
  });

  test("caps long lists", () => {
    const steps = Array.from({ length: 13 }, (_, i) => step(i + 1, "floating-promise"));
    expect(formatPrDescription(plan(steps), result([])).body).toContain("...and 3 more");
  });

  test("failed audit is reported, not hidden", () => {
    const out = formatPrDescription(plan([], { ok: false, error: "boom" }), result([]));
    expect(out.title).toBe("fix: audit could not run");
    expect(out.body).toContain("boom");
    expect(formatPrDescription(plan([]), result([], { ok: false, error: "late" })).body).toContain("late");
  });

  test("contains no attribution lines", () => {
    const body = formatPrDescription(plan([step(1, "floating-promise")]), result([{ fix: fix("floating-promise", "t"), status: "verified" }])).body;
    expect(body).not.toMatch(/Co-Authored-By|Claude|Generated with/i);
  });
});

describe("buildPrDescription and CLI", () => {
  let root: string;
  let out: string[];
  let err: string[];

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "agent-v2-prd-"));
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "package.json"), '{"name":"x","version":"1.0.0"}\n');
    writeFileSync(join(root, "src", "a.ts"), `export async function load(): Promise<void> {\n  fetch("/x");\n}\nexport const k = "${SECRET}";\n`);
    out = [];
    err = [];
    vi.spyOn(process.stdout, "write").mockImplementation((c: string | Uint8Array) => (out.push(String(c)), true));
    vi.spyOn(process.stderr, "write").mockImplementation((c: string | Uint8Array) => (err.push(String(c)), true));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(root, { recursive: true, force: true });
  });

  test("uses the real verification result and never prints the secret", async () => {
    const d = await buildPrDescription({ projectRoot: root });
    expect(d.title).toContain("await 1 floating promise");
    expect(d.body).toContain("src/a.ts:2");
    expect(JSON.stringify(d)).not.toContain(SECRET);
    expect(readFileSync(join(root, "src", "a.ts"), "utf-8")).toContain(SECRET);
  });

  test("CLI prints text, JSON and writes a file", async () => {
    expect(await runPrDescriptionCli(["--project", root])).toBe(0);
    expect(out.join("")).toMatch(/^Title: fix:/);
    out.length = 0;
    expect(await runPrDescriptionCli(["--project", root, "--json"])).toBe(0);
    expect((JSON.parse(out.join("")) as { title: string }).title).toContain("fix:");
    const file = join(root, "pr.md");
    expect(await runPrDescriptionCli(["--project", root, "--out", file])).toBe(0);
    expect(readFileSync(file, "utf-8")).toContain("## الاختبار / Testing");
    expect(out.join("") + err.join("")).not.toContain(SECRET);
  });

  test("CLI usage errors exit 2", async () => {
    expect(await runPrDescriptionCli(["--help"])).toBe(0);
    for (const args of [["--bogus"], ["--project"], ["--out"], ["--choose", "nope"], ["--project", join(root, "missing")]]) {
      expect(await runPrDescriptionCli(args)).toBe(2);
    }
  });
});
