import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  configs: [] as unknown[],
  results: [] as Array<{ module: string }>,
  scan: vi.fn(),
}));

vi.mock("../../../src/core/orchestrator.js", () => ({
  AuditOrchestrator: class {
    constructor(_ctx: unknown, config: unknown) {
      state.configs.push(config);
    }
    async execute(): Promise<unknown> {
      return { results: state.results };
    }
  },
}));
vi.mock("../../../src/core/audit-context.js", () => ({ buildAuditContext: () => ({}) }));
vi.mock("../../../src/scan/bridge.js", () => ({ runScanAudit: state.scan }));

import { collectAuditResults } from "../../../src/orchestrator/collect-results.js";

describe("collectAuditResults", () => {
  beforeEach(() => {
    state.configs = [];
    state.results = [{ module: "security-guard" }, { module: "dead-code-guard" }];
    state.scan.mockReset();
    state.scan.mockResolvedValue({ result: { module: "scan" }, report: { aiAdvisory: null } });
  });

  it("hands the module filter to the orchestrator so unselected guards never run", async () => {
    const { results } = await collectAuditResults({ projectRoot: "/p", modules: [" Security "] });
    expect(state.configs[0]).toMatchObject({ moduleFilter: ["security"] });
    expect(results.map((r) => r.module)).toEqual(["security-guard"]);
  });

  it("leaves the scan layer out when the filter does not name it", async () => {
    await collectAuditResults({ projectRoot: "/p", modules: ["security"], scan: true });
    expect(state.scan).not.toHaveBeenCalled();
  });

  it("runs the scan layer when it is selected or no filter is given", async () => {
    await collectAuditResults({ projectRoot: "/p", modules: ["scan"], scan: true });
    await collectAuditResults({ projectRoot: "/p", scan: true });
    expect(state.scan).toHaveBeenCalledTimes(2);
  });
});
