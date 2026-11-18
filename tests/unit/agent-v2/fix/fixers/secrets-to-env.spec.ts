import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { DEFAULT_FIXERS } from "../../../../../src/agent-v2/fix/registry.js";
import { formatFixReport } from "../../../../../src/agent-v2/fix/report.js";
import { SecretsToEnvFixer } from "../../../../../src/agent-v2/fix/fixers/secrets-to-env.js";
import { runFixSession } from "../../../../../src/agent-v2/fix/session.js";
import type { FixerResult, ProposedFix } from "../../../../../src/agent-v2/fix/types.js";
import { verifyFix } from "../../../../../src/agent-v2/fix/verify.js";
import { createPlan } from "../../../../../src/agent-v2/planner.js";
import { fakeSecret, makeTmpProject, removeProject, writeProjectFile } from "../../support.js";

const SECRET = fakeSecret();
const OTHER_SECRET = ["sk", "live", "Z9y8X7w6V5u4T3s2R1q0P9o8"].join("_");
const roots: string[] = [];

function project(files: Record<string, string>): string {
  const root = makeTmpProject("agent-v2-secfix-");
  roots.push(root);
  writeProjectFile(root, "package.json", JSON.stringify({ name: "t", version: "1.0.0" }));
  Object.entries(files).forEach(([file, content]) => writeProjectFile(root, file, content));
  return root;
}
afterEach(() => roots.splice(0).forEach(removeProject));

async function proposeFor(root: string): Promise<FixerResult[]> {
  const plan = await createPlan({ projectRoot: root });
  return new SecretsToEnvFixer().propose(plan.steps.filter((s) => s.fixClass === "hardcoded-secret"), { projectRoot: root, choices: new Map() });
}

function fixes(results: FixerResult[]): ProposedFix[] {
  return results.flatMap((r) => (r.kind === "fix" ? [r.fix] : []));
}

function edit(fix: ProposedFix, file: string): string {
  const found = fix.edits.find((e) => e.file === file);
  if (found === undefined) throw new Error(`no edit for ${file}`);
  return found.content;
}

function git(root: string, args: string[]): void {
  execFileSync("git", args, { cwd: root, stdio: "ignore" });
}

function listFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? listFiles(join(dir, e.name)) : [join(dir, e.name)]));
}

function filesContaining(root: string, value: string): string[] {
  return listFiles(root).filter((f) => readFileSync(f, "utf-8").includes(value));
}

const CONFIG = `export const stripeKey: string = "${SECRET}";\n`;

describe("SecretsToEnvFixer", () => {
  test("a key left in a comment is not rewritten: the fixer skips it and says to delete and rotate", async () => {
    const root = project({ "src/config.ts": `export const a = 1;\n// old key: ${SECRET}\n` });
    const results = await proposeFor(root);
    expect(fixes(results)).toEqual([]);
    expect(results).toContainEqual(expect.objectContaining({ kind: "skip", reason: expect.stringContaining("in a comment") }));
  });

  test("replaces the literal with process.env.NAME, documents NAME= empty and passes verifyFix", async () => {
    const root = project({ "src/config.ts": `${CONFIG}export const port = process.env.PORT;\n` });
    const results = await proposeFor(root);
    const [fix] = fixes(results);
    expect(fix).toBeDefined();
    if (fix === undefined) return;
    expect(edit(fix, "src/config.ts")).toBe("export const stripeKey: string = process.env.STRIPE_KEY;\nexport const port = process.env.PORT;\n");
    expect(edit(fix, ".env.example")).toContain("STRIPE_KEY=\n");
    expect(edit(fix, ".env.example")).toContain("PORT=\n");
    expect(fix.removesSecret).toBe(true);
    expect(fix.fixClass).toBe("hardcoded-secret");
    expect(fix.title).toBe("Move secret in src/config.ts:1 to process.env.STRIPE_KEY");
    expect(fix.edits.some((e) => e.content.includes(SECRET))).toBe(false);
    const outcome = await verifyFix(root, fix);
    expect(outcome).toMatchObject({ accepted: true });
  });

  test("warnings are present and nothing but the edits mentions the value", async () => {
    const root = project({ "src/config.ts": CONFIG });
    const [fix] = fixes(await proposeFor(root));
    expect(fix?.warnings).toContain("Rotate this credential: it was written in source code");
    expect(fix?.warnings.some((w) => w.includes("string | undefined"))).toBe(true);
    expect(JSON.stringify({ w: fix?.warnings, t: fix?.title, r: fix?.resolves, id: fix?.id })).not.toContain(SECRET);
    expect(fix?.resolves).toHaveLength(1);
  });

  test("derives names from object keys and falls back to the secret type", async () => {
    const root = project({ "src/a.ts": `export const cfg = {\n  apiKey: "${SECRET}",\n};\n`, "src/b.ts": `export default ["${OTHER_SECRET}"];\n` });
    const titles = fixes(await proposeFor(root)).map((f) => f.title);
    expect(titles).toContain("Move secret in src/a.ts:2 to process.env.API_KEY");
    expect(titles.some((t) => t.startsWith("Move secret in src/b.ts:1 to process.env.API_KEY_2"))).toBe(true);
  });

  test("name collision with a variable already used gets a numeric suffix", async () => {
    const root = project({ "src/config.ts": `${CONFIG}export const other = process.env.STRIPE_KEY;\n` });
    const [fix] = fixes(await proposeFor(root));
    expect(fix?.title).toContain("process.env.STRIPE_KEY_2");
    expect(edit(fix as ProposedFix, ".env.example")).toContain("STRIPE_KEY_2=\n");
  });

  test("name collision with a variable listed in .env.example gets a suffix", async () => {
    const root = project({ "src/config.ts": CONFIG, ".env.example": "STRIPE_KEY=\n" });
    const [fix] = fixes(await proposeFor(root));
    expect(fix?.title).toContain("process.env.STRIPE_KEY_2");
    expect(edit(fix as ProposedFix, ".env.example").startsWith("STRIPE_KEY=\n")).toBe(true);
  });

  test("two secrets in one file get distinct names", async () => {
    const root = project({ "src/config.ts": `${CONFIG}export const stripeKey = "${OTHER_SECRET}";\n` });
    const titles = fixes(await proposeFor(root)).map((f) => f.title);
    expect(new Set(titles).size).toBe(2);
  });

  test("skips a line with two candidate literals", async () => {
    const root = project({ "src/config.ts": `export const keys = ["${SECRET}", "${OTHER_SECRET}"];\n` });
    const results = await proposeFor(root);
    expect(fixes(results)).toHaveLength(0);
    expect(results.every((r) => r.kind === "skip")).toBe(true);
    expect(JSON.stringify(results)).not.toContain(SECRET);
  });

  test("skips a template literal with interpolation", async () => {
    const root = project({ "src/config.ts": `const p = "x";\nexport const k = \`\${p}${SECRET}\`;\n` });
    const results = await proposeFor(root);
    expect(fixes(results)).toHaveLength(0);
    expect(results.some((r) => r.kind === "skip")).toBe(true);
  });

  test("skips a multi-line private key (no literal on the reported line)", async () => {
    const pem = ["-----BEGIN RSA", "PRIVATE KEY-----"].join(" ");
    const root = project({ "src/key.ts": `export const k = \`${pem}\nMIIEabcdefghijklmnopqrstuvwxyz0123456789\n-----END RSA PRIVATE KEY-----\`;\n` });
    expect(fixes(await proposeFor(root))).toHaveLength(0);
  });

  test("verifyFix rejects an edit set that leaves the secret in place", async () => {
    const root = project({ "src/config.ts": CONFIG });
    const [fix] = fixes(await proposeFor(root));
    if (fix === undefined) throw new Error("no fix");
    const bad: ProposedFix = { ...fix, edits: [{ file: ".env.example", content: edit(fix, ".env.example") }] };
    const outcome = await verifyFix(root, bad);
    expect(outcome.accepted).toBe(false);
  });
});

describe("git history warnings", () => {
  test("warns when the value was committed", async () => {
    const root = project({ "src/config.ts": CONFIG });
    git(root, ["init", "-q"]);
    git(root, ["config", "user.name", "t"]);
    git(root, ["config", "user.email", "t@example.com"]);
    git(root, ["add", "."]);
    git(root, ["commit", "-q", "-m", "init"]);
    const [fix] = fixes(await proposeFor(root));
    expect(fix?.warnings.some((w) => w.includes("exists in git history"))).toBe(true);
    expect(fix?.warnings.some((w) => w.includes("Could not check"))).toBe(false);
    expect(JSON.stringify(fix?.warnings)).not.toContain(SECRET);
  });

  test("no history warning when a git repo never contained the value", async () => {
    const root = project({ "src/config.ts": "export const a = 1;\n" });
    git(root, ["init", "-q"]);
    git(root, ["config", "user.name", "t"]);
    git(root, ["config", "user.email", "t@example.com"]);
    git(root, ["add", "."]);
    git(root, ["commit", "-q", "-m", "init"]);
    writeFileSync(join(root, "src/config.ts"), CONFIG);
    const [fix] = fixes(await proposeFor(root));
    expect(fix?.warnings.some((w) => w.includes("git history"))).toBe(false);
    expect(fix?.warnings.some((w) => w.includes("Could not check"))).toBe(false);
  });

  test("warns that history could not be checked outside git", async () => {
    const root = project({ "src/config.ts": CONFIG });
    const [fix] = fixes(await proposeFor(root));
    expect(fix?.warnings).toContain("Could not check git history; assume the secret is exposed and rotate it");
  });
});

describe("runFixSession with the default fixers", () => {
  const SOURCE = `${CONFIG}export const port = process.env.PORT;\n`;

  test("propose: secret fix verified but absent from the patch; env patch applies; no leak anywhere", async () => {
    const root = project({ "src/config.ts": SOURCE });
    const result = await runFixSession({ projectRoot: root, mode: "propose", fixers: DEFAULT_FIXERS });
    expect(result.ok).toBe(true);
    const secretOutcome = result.outcomes.find((o) => o.fix.fixClass === "hardcoded-secret");
    expect(secretOutcome?.status).toBe("verified");
    const envOutcome = result.outcomes.find((o) => o.fix.fixClass === "env-documentation");
    expect(envOutcome?.status).toBe("verified");
    expect(result.patch).toContain(".env.example");
    expect(result.patch).not.toContain("src/config.ts");
    expect(result.patch).not.toContain(SECRET);
    expect(formatFixReport(result, "x.patch")).not.toContain(SECRET);
    expect(JSON.stringify(result)).not.toContain(SECRET);

    const patchFile = join(makeTmpProject("agent-v2-patch-"), "fix.patch");
    roots.push(join(patchFile, ".."));
    writeFileSync(patchFile, result.patch);
    execFileSync("git", ["apply", "--check", patchFile], { cwd: root, stdio: "ignore" });
    expect(filesContaining(root, "process.env.STRIPE_KEY")).toEqual([]);
    expect(readFileSync(join(root, "src/config.ts"), "utf-8")).toBe(SOURCE);
  });

  test("apply: value is removed from the whole working tree and NAME= is documented", async () => {
    const root = project({ "src/config.ts": SOURCE });
    const result = await runFixSession({ projectRoot: root, mode: "apply", fixers: DEFAULT_FIXERS, approve: async () => true });
    expect(result.ok).toBe(true);
    expect(result.outcomes.map((o) => o.status)).toContain("applied");
    expect(filesContaining(root, SECRET)).toEqual([]);
    expect(readFileSync(join(root, "src/config.ts"), "utf-8")).toContain("process.env.STRIPE_KEY");
    expect(readFileSync(join(root, ".env.example"), "utf-8")).toContain("STRIPE_KEY=\n");
    expect(formatFixReport(result)).not.toContain(SECRET);
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });
});
