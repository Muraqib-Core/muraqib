import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { buildEnvExample, EnvExampleFixer } from "../../../../../src/agent-v2/fix/fixers/env-example.js";
import { verifyFix } from "../../../../../src/agent-v2/fix/verify.js";
import type { FixerResult, ProposedFix } from "../../../../../src/agent-v2/fix/types.js";
import { createPlan } from "../../../../../src/agent-v2/planner.js";
import { makeTmpProject, removeProject, writeProjectFile } from "../../support.js";

const roots: string[] = [];
function project(files: Record<string, string>): string {
  const root = makeTmpProject("agent-v2-envfix-");
  roots.push(root);
  writeProjectFile(root, "package.json", JSON.stringify({ name: "t", version: "1.0.0" }));
  for (const [file, content] of Object.entries(files)) writeProjectFile(root, file, content);
  return root;
}
afterEach(() => roots.splice(0).forEach(removeProject));

const SOURCE = "export const a = process.env.ALPHA;\nexport const b = process.env['BETA'];\nexport const c = process.env.NODE_ENV;\n";

async function proposeFor(root: string): Promise<FixerResult[]> {
  const plan = await createPlan({ projectRoot: root });
  return new EnvExampleFixer().propose(plan.steps.filter((s) => s.fixClass === "env-documentation"), { projectRoot: root, choices: new Map() });
}

function onlyFix(results: FixerResult[]): ProposedFix {
  const fix = results.find((r): r is Extract<FixerResult, { kind: "fix" }> => r.kind === "fix");
  if (fix === undefined) throw new Error("no fix produced");
  return fix.fix;
}

describe("buildEnvExample", () => {
  test("creates the file from used variables with no values", () => {
    const root = project({ "src/a.ts": SOURCE });
    const content = buildEnvExample(root);
    expect(content).toMatch(/^#/);
    expect(content).toContain("ALPHA=\n");
    expect(content).toContain("BETA=\n");
    expect(content).not.toContain("NODE_ENV");
    expect(content.split("\n").filter((l) => l !== "" && !l.startsWith("#")).every((l) => /^[A-Z_]+=$/.test(l))).toBe(true);
  });

  test("keeps an existing file untouched and appends only missing names", () => {
    const existing = "# my notes\nALPHA=keep-me\nOTHER=1";
    const root = project({ "src/a.ts": SOURCE, ".env.example": existing });
    const content = buildEnvExample(root, ["EXTRA"]);
    expect(content.startsWith(existing)).toBe(true);
    expect(content).toBe(`${existing}\nBETA=\nEXTRA=\n`);
  });

  test("returns the existing content when everything is documented", () => {
    const existing = "ALPHA=\nBETA=\n";
    const root = project({ "src/a.ts": SOURCE, ".env.example": existing });
    expect(buildEnvExample(root)).toBe(existing);
  });
});

describe("EnvExampleFixer", () => {
  test("one grouped fix creates .env.example and is accepted by verifyFix", async () => {
    const root = project({ "src/a.ts": SOURCE });
    const plan = await createPlan({ projectRoot: root });
    const ids = plan.steps.filter((s) => s.fixClass === "env-documentation").map((s) => s.issueId);
    const fix = onlyFix(await proposeFor(root));
    expect(fix.title).toBe("Create .env.example with 2 variable(s)");
    expect(fix.resolves).toEqual(ids);
    expect(fix.edits.map((e) => e.file)).toEqual([".env.example"]);
    expect(fix.removesSecret).toBe(false);
    const outcome = await verifyFix(root, fix);
    expect(outcome.accepted).toBe(true);
  });

  test("updates an existing file with one grouped fix for all undocumented variables", async () => {
    const root = project({ "src/a.ts": SOURCE, ".env.example": "ALPHA=\n" });
    const results = await proposeFor(root);
    expect(results.filter((r) => r.kind === "fix")).toHaveLength(1);
    const fix = onlyFix(results);
    expect(fix.title).toBe("Update .env.example with 1 variable(s)");
    expect((await verifyFix(root, fix)).accepted).toBe(true);
    expect(readFileSync(join(root, ".env.example"), "utf-8")).toBe("ALPHA=\n");
  });

  test("skips with a reason when there is nothing to add", () => {
    const root = project({ "src/a.ts": SOURCE, ".env.example": "ALPHA=\nBETA=\n" });
    const step = { rank: 1, issueId: "x1", module: "m", code: "c", severity: "warning" as const, title: "t", fixClass: "env-documentation" as const, autoFixable: true, reasons: [] };
    const results = new EnvExampleFixer().propose([step], { projectRoot: root, choices: new Map() });
    expect(results).toEqual([{ kind: "skip", issueId: "x1", reason: "nothing to add to .env.example" }]);
  });
});
