import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.hoisted(() => vi.fn());
vi.mock("axios", () => ({ default: { get } }));

import { analyzeLatency, performLiveLatencyAudit } from "../../../src/core/performance/network-latency-advisor.js";

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  get.mockReset();
});

describe("analyzeLatency", () => {
  it("passes small fast responses", () => {
    expect(analyzeLatency(100, 5)).toEqual({ isOptimized: true, reports: [] });
  });
  it("flags payload and latency independently and together", () => {
    expect(analyzeLatency(100, 20).reports).toHaveLength(1);
    expect(analyzeLatency(400, 5).reports).toHaveLength(1);
    expect(analyzeLatency(400, 20).isOptimized).toBe(false);
    expect(analyzeLatency(400, 20).reports).toHaveLength(2);
  });
});

describe("performLiveLatencyAudit", () => {
  it("uses content-length when present", async () => {
    get.mockResolvedValue({ headers: { "content-length": "2048" }, data: "x" });
    const r = await performLiveLatencyAudit("http://x");
    expect(r.reachable).toBe(true);
    expect(r.payloadSizeKb).toBe(2);
    expect(r.isOptimized).toBe(true);
  });

  it("measures the body when content-length is missing and warns when slow/large", async () => {
    get.mockResolvedValue({ headers: {}, data: "y".repeat(20 * 1024) });
    const r = await performLiveLatencyAudit("http://x");
    expect(r.payloadSizeKb).toBeGreaterThan(14);
    expect(r.isOptimized).toBe(false);
    expect(console.warn).toHaveBeenCalled();
  });

  it("treats an unreachable target as a failed check (Error and non-Error)", async () => {
    get.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const a = await performLiveLatencyAudit("http://x");
    expect(a.reachable).toBe(false);
    expect(a.reports[0]).toContain("ECONNREFUSED");
    get.mockRejectedValueOnce("nope");
    const b = await performLiveLatencyAudit("http://x");
    expect(b.reports[0]).toContain("nope");
  });
});
