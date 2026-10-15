import { describe, expect, it } from "vitest";
import { MemoryGuard, performMemoryAudit } from "./memory-guard.js";

const GENEROUS = {
  heapWarnMb: 1e6,
  heapCriticalMb: 2e6,
  rssWarnMb: 1e6,
  externalWarnMb: 1e6,
  heapRatioWarn: 2,
};

describe("memory-guard findings", () => {
  it("reports nothing with generous thresholds", () => {
    const result = performMemoryAudit(GENEROUS);
    expect(result.isOptimized).toBe(true);
    expect(result.findings).toEqual([]);
    expect(result.notes).toEqual([]);
  });

  it("zero thresholds force every report with stable codes and severities", () => {
    const result = performMemoryAudit({ heapWarnMb: 0, heapCriticalMb: 0, rssWarnMb: 0, externalWarnMb: 0, heapRatioWarn: 0 });
    expect(result.findings.map((f) => f.code)).toEqual([
      "MEMORY_HEAP_CRITICAL",
      "MEMORY_RSS_HIGH",
      "MEMORY_EXTERNAL_HIGH",
      "MEMORY_HEAP_FRAGMENTATION",
    ]);
    expect(result.findings.map((f) => f.severity)).toEqual(["critical", "error", "error", "warning"]);
    expect(result.reports).toEqual(result.findings.map((f) => f.message));
    expect(result.leakRisk).toBe("high");
  });

  it("uses MEMORY_HEAP_HIGH between warn and critical", () => {
    const result = performMemoryAudit({ ...GENEROUS, heapWarnMb: 0 });
    expect(result.findings.map((f) => f.code)).toEqual(["MEMORY_HEAP_HIGH"]);
    expect(result.findings[0]?.severity).toBe("error");
  });

  it("guard issues use the finding codes, not text-derived ones", async () => {
    const result = await new MemoryGuard({ ...GENEROUS, heapRatioWarn: 0, rssWarnMb: 0 }).execute();
    expect(result.issues.map((i) => i.code)).toEqual(["MEMORY_RSS_HIGH", "MEMORY_HEAP_FRAGMENTATION"]);
    expect(result.issues.map((i) => i.severity)).toEqual(["error", "warning"]);
  });

  it("falls back to defaults for NaN, infinite and negative options", () => {
    const result = performMemoryAudit({ heapWarnMb: Number.NaN, heapCriticalMb: -5, rssWarnMb: Number.POSITIVE_INFINITY, externalWarnMb: -1, heapRatioWarn: Number.NaN });
    expect(result.notes).toHaveLength(5);
    // With defaults a small test process is not flagged for heap/rss/external
    expect(result.findings.some((f) => f.code === "MEMORY_HEAP_CRITICAL" || f.code === "MEMORY_RSS_HIGH")).toBe(false);
    expect(result.findings.some((f) => f.code === "MEMORY_EXTERNAL_HIGH")).toBe(false);
  });

  it("swaps heapWarnMb above heapCriticalMb and notes it", () => {
    const result = performMemoryAudit({ ...GENEROUS, heapWarnMb: 2e6, heapCriticalMb: 0 });
    expect(result.notes.some((n) => n.includes("swapped"))).toBe(true);
    // after swap: warn 0, critical 2e6 -> high, not critical
    expect(result.findings.map((f) => f.code)).toEqual(["MEMORY_HEAP_HIGH"]);
  });

  it("never yields NaN fragmentation", () => {
    const result = performMemoryAudit({ ...GENEROUS, heapRatioWarn: 0 });
    expect(result.reports.every((r) => !r.includes("NaN"))).toBe(true);
  });
});
