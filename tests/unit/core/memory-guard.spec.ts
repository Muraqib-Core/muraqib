import { describe, expect, test } from "vitest";
import { MemoryGuard, performMemoryAudit } from "../../../src/core/memory-guard.js";

const TIGHT = {
  heapWarnMb: 0,
  heapCriticalMb: 100000,
  rssWarnMb: 0,
  externalWarnMb: 0,
  heapRatioWarn: 0,
};

describe("memory guard", () => {
  test("reports nothing with very generous thresholds", () => {
    const result = performMemoryAudit({
      heapWarnMb: 100000,
      heapCriticalMb: 200000,
      rssWarnMb: 100000,
      externalWarnMb: 100000,
      heapRatioWarn: 2,
    });
    expect(result.isOptimized).toBe(true);
    expect(result.leakRisk).toBe("none");
    expect(result.heapUsedMb).toBeGreaterThan(0);
  });

  test("flags a critical heap when the critical limit is exceeded", () => {
    const result = performMemoryAudit({ ...TIGHT, heapCriticalMb: 0 });
    expect(result.reports[0]).toContain("Critical heap usage");
  });

  test("flags high heap, rss, external and fragmentation with tight limits", () => {
    const result = performMemoryAudit({ ...TIGHT, externalWarnMb: -1 });
    const text = result.reports.join("\n");
    expect(text).toContain("High heap usage");
    expect(text).toContain("High RSS memory");
    expect(text).toContain("High external memory");
    expect(text).toContain("Heap fragmentation risk");
    expect(result.leakRisk).toBe("high");
  });

  test("grades leak risk by number of reports", () => {
    const generous = {
      heapWarnMb: 100000,
      heapCriticalMb: 200000,
      rssWarnMb: 100000,
      externalWarnMb: 100000,
      heapRatioWarn: 2,
    };
    expect(performMemoryAudit({ ...generous, rssWarnMb: 0 }).leakRisk).toBe("low");
    expect(performMemoryAudit({ ...generous, rssWarnMb: 0, heapWarnMb: 0 }).leakRisk).toBe("medium");
  });

  test("guard returns ok when optimal", async () => {
    const result = await new MemoryGuard({
      heapWarnMb: 100000,
      heapCriticalMb: 200000,
      rssWarnMb: 100000,
      externalWarnMb: 100000,
      heapRatioWarn: 2,
    }).execute();
    expect(result.status).toBe("ok");
    expect(result.message).toContain("Memory usage optimal");
  });

  test("guard maps critical reports to critical and high reports to error", async () => {
    const result = await new MemoryGuard({ ...TIGHT, heapCriticalMb: 0 }).execute();
    expect(result.status).toBe("error");
    const severities = result.issues.map((i) => i.severity);
    expect(severities).toContain("critical");
    expect(severities).toContain("error");
    expect(result.issues[0]?.code.startsWith("MEMORY_")).toBe(true);
  });

  test("guard maps fragmentation (no 'High'/'Critical') to a warning", async () => {
    const result = await new MemoryGuard({
      heapWarnMb: 100000,
      heapCriticalMb: 200000,
      rssWarnMb: 100000,
      externalWarnMb: 100000,
      heapRatioWarn: 0,
    }).execute();
    expect(result.issues.map((i) => i.severity)).toEqual(["warning"]);
  });
});
