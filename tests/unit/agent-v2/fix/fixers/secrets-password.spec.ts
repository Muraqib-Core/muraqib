import { afterEach, describe, expect, test } from "vitest";
import { SecretsToEnvFixer } from "../../../../../src/agent-v2/fix/fixers/secrets-to-env.js";
import { verifyFix } from "../../../../../src/agent-v2/fix/verify.js";
import { createPlan } from "../../../../../src/agent-v2/planner.js";
import { makeTmpProject, removeProject, writeProjectFile } from "../../support.js";

const PASSWORD = ["Hunter2", "Passw0rd", "xyz"].join("");
const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(removeProject));

describe("password assignments (regression found by the evaluation)", () => {
  test("a quoted password is moved to process.env, even though the detector's password rule matches any short value", async () => {
    const root = makeTmpProject("agent-v2-pw-");
    roots.push(root);
    writeProjectFile(root, "package.json", JSON.stringify({ name: "t", version: "1.0.0" }));
    writeProjectFile(root, "src/admin.ts", `export const adminPassword = "${PASSWORD}";\n`);

    const plan = await createPlan({ projectRoot: root });
    const steps = plan.steps.filter((s) => s.fixClass === "hardcoded-secret");
    expect(steps).toHaveLength(1);
    const results = new SecretsToEnvFixer().propose(steps, { projectRoot: root, choices: new Map() });
    const fix = results.flatMap((r) => (r.kind === "fix" ? [r.fix] : []))[0];
    expect(fix).toBeDefined();
    if (fix === undefined) return;

    const source = fix.edits.find((e) => e.file === "src/admin.ts")?.content ?? "";
    expect(source).toContain("process.env.ADMIN_PASSWORD");
    expect(source).not.toContain(PASSWORD);
    expect(fix.edits.find((e) => e.file === ".env.example")?.content).toContain("ADMIN_PASSWORD=\n");
    expect(JSON.stringify([fix.title, fix.warnings, fix.resolves, fix.id])).not.toContain(PASSWORD);
    expect((await verifyFix(root, fix)).accepted).toBe(true);
  });
});
