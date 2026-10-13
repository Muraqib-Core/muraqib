import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.hoisted(() => vi.fn());

/** Build a minimal fetch Response stand-in. */
function reply(headers: Record<string, string>, body: string, init: { ok?: boolean; status?: number } = {}) {
  return new Response(body, { status: init.status ?? 200, headers });
}

import { analyzeLatency, performLiveLatencyAudit } from "../../../src/core/performance/network-latency-advisor.js";

beforeEach(() => {
  vi.stubGlobal("fetch", get);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
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
    get.mockResolvedValue(reply({ "content-length": "2048" }, "x"));
    const r = await performLiveLatencyAudit("http://x");
    expect(r.reachable).toBe(true);
    expect(r.payloadSizeKb).toBe(2);
    expect(r.isOptimized).toBe(true);
  });

  it("measures the body when content-length is missing and warns when slow/large", async () => {
    get.mockResolvedValue(reply({}, "y".repeat(20 * 1024)));
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

  it("treats a non-2xx response as unreachable and passes an AbortSignal timeout", async () => {
    get.mockResolvedValueOnce(reply({}, "err", { status: 503 }));
    const r = await performLiveLatencyAudit("http://x");
    expect(r.reachable).toBe(false);
    expect(r.reports[0]).toContain("HTTP 503");
    expect(get.mock.calls[0]?.[1]).toMatchObject({ signal: expect.any(AbortSignal) });
  });
});
