import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NetworkLatencyGuard } from "../../../../src/core/performance/network-latency-advisor.js";

const fetchMock = vi.hoisted(() => vi.fn());

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  fetchMock.mockReset();
});

describe("NetworkLatencyGuard.execute issue branches", () => {
  it("reports only NETWORK_002 for a large but fast response", async () => {
    fetchMock.mockResolvedValue(new Response("y".repeat(20 * 1024), { status: 200 }));
    const result = await new NetworkLatencyGuard({ targetUrl: "http://x" }).execute();
    const codes = result.issues.map(i => i.code);
    expect(codes).toEqual(["NETWORK_002"]);
  });

  it("reports only NETWORK_003 for a small but slow response", async () => {
    const nowSpy = vi.spyOn(Date, "now");
    nowSpy.mockReturnValueOnce(1000).mockReturnValueOnce(2000);
    fetchMock.mockResolvedValue(new Response("ok", { status: 200 }));
    const result = await new NetworkLatencyGuard({ targetUrl: "http://x" }).execute();
    const codes = result.issues.map(i => i.code);
    expect(codes).toEqual(["NETWORK_003"]);
  });

  it("reports both NETWORK_002 and NETWORK_003 when both budgets are exceeded", async () => {
    const nowSpy = vi.spyOn(Date, "now");
    nowSpy.mockReturnValueOnce(1000).mockReturnValueOnce(2000);
    fetchMock.mockResolvedValue(new Response("y".repeat(20 * 1024), { status: 200 }));
    const result = await new NetworkLatencyGuard({ targetUrl: "http://x" }).execute();
    const codes = result.issues.map(i => i.code);
    expect(codes).toEqual(["NETWORK_002", "NETWORK_003"]);
  });
});
