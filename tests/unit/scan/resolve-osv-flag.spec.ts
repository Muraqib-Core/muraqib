import { afterEach, describe, expect, test, vi } from "vitest";

const { runResolveWorkflow } = vi.hoisted(() => ({ runResolveWorkflow: vi.fn() }));

vi.mock("../../../src/scan/cli/resolve-workflow.js", () => ({ runResolveWorkflow }));
vi.mock("../../../src/scan/core/context/project-context.js", () => ({
  createProjectContext: vi.fn(() => ({ projectPath: "/p" })),
}));

import { main } from "../../../src/scan/cli.js";

describe("scan CLI: resolve --osv", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    runResolveWorkflow.mockReset();
  });

  test("accepts --osv (resolve always uses OSV data) and runs the workflow", async () => {
    await main(["resolve", "--osv"]);
    expect(runResolveWorkflow).toHaveBeenCalledTimes(1);
  });

  test("help documents the flag", async () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
      lines.push(a.join(" "));
    });
    await main(["--help"]);
    expect(lines.join("\n")).toContain("--osv");
  });
});
