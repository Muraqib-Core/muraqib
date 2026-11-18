import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createPlan } from "../../../src/agent-v2/planner.js";
import type { AgentPlan } from "../../../src/agent-v2/types.js";
import { fakeSecret, generateDemoFixture, removeProject } from "./support.js";

let root = "";
beforeAll(() => {
  root = generateDemoFixture();
});
afterAll(() => removeProject(root));

describe("createPlan on the demo fixture", () => {
  test("contains all three fix classes in the expected order", async () => {
    const plan: AgentPlan = await createPlan({ projectRoot: root });
    expect(plan.ok).toBe(true);
    expect(plan.verdict).toBe("fail");
    const classes = plan.steps.map((s) => s.fixClass);
    expect(classes).toContain("floating-promise");
    expect(classes).toContain("hardcoded-secret");
    expect(classes).toContain("env-documentation");
    // critical secret first, env (warning) documentation after higher severities
    expect(plan.steps[0]?.fixClass).toBe("hardcoded-secret");
    const firstIdx = (c: string): number => classes.indexOf(c as never);
    expect(firstIdx("hardcoded-secret")).toBeLessThan(firstIdx("floating-promise"));
    expect(firstIdx("floating-promise")).toBeLessThanOrEqual(firstIdx("env-documentation"));
    expect(plan.steps.map((s) => s.rank)).toEqual(plan.steps.map((_, i) => i + 1));
    expect(plan.summary.byFixClass["env-documentation"]).toBe(1);
    expect(JSON.stringify(plan)).not.toContain(fakeSecret());
  });

  test("two runs are deep-equal JSON", async () => {
    const a = JSON.stringify(await createPlan({ projectRoot: root }));
    const b = JSON.stringify(await createPlan({ projectRoot: root }));
    expect(a).toBe(b);
  });

  test("maxSteps caps the plan", async () => {
    const plan = await createPlan({ projectRoot: root, maxSteps: 1 });
    expect(plan.steps).toHaveLength(1);
  });
});
