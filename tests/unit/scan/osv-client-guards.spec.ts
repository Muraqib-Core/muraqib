import { afterEach, describe, expect, test, vi } from "vitest";
import { EventEmitter } from "node:events";

class FakeRequest extends EventEmitter {
  destroyed = false;
  write = vi.fn();
  end = vi.fn();
  destroy = vi.fn(() => {
    this.destroyed = true;
  });
}

const state = vi.hoisted(() => ({ onResponse: undefined as undefined | ((res: unknown) => void), req: undefined as unknown }));

vi.mock("node:http", async () => {
  const actual = await vi.importActual<typeof import("node:http")>("node:http");
  const request = (_options: unknown, cb: (res: unknown) => void): unknown => {
    state.onResponse = cb;
    return state.req;
  };
  return { ...actual, default: { ...actual, request }, request };
});

async function load(): Promise<typeof import("../../../src/scan/scanners/dependency/osv-client.js")> {
  vi.stubEnv("OSV_API_URL", "http://127.0.0.1:9/v1/query");
  vi.resetModules();
  return import("../../../src/scan/scanners/dependency/osv-client.js");
}

function makeResponse(statusCode: number): EventEmitter & { statusCode: number } {
  return Object.assign(new EventEmitter(), { statusCode });
}

describe("queryOsv handled-state guards", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  test("late data and end events after the size limit abort are ignored", async () => {
    const req = new FakeRequest();
    state.req = req;
    const { queryOsv } = await load();
    const pending = queryOsv("big", "1.0.0");
    const res = makeResponse(200);
    state.onResponse?.(res);
    res.emit("data", Buffer.alloc(6 * 1024 * 1024));
    res.emit("data", Buffer.from("late"));
    res.emit("end");
    req.emit("timeout");
    req.emit("error", new Error("late"));
    const result = await pending;
    expect(result.status).toBe("error");
    expect(req.destroy).toHaveBeenCalledTimes(1);
  });

  test("a timeout after the response ended keeps the original result", async () => {
    const req = new FakeRequest();
    state.req = req;
    const { queryOsv } = await load();
    const pending = queryOsv("ok", "1.0.0");
    const res = makeResponse(200);
    state.onResponse?.(res);
    res.emit("data", Buffer.from(JSON.stringify({ vulns: [] })));
    res.emit("end");
    req.emit("timeout");
    const result = await pending;
    expect(result.status).toBe("success");
    expect(req.destroy).not.toHaveBeenCalled();
  });
});
