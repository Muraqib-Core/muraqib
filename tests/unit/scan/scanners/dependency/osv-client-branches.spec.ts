import { afterEach, describe, expect, test, vi } from "vitest";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import type { queryOsv as QueryOsv } from "../../../../../src/scan/scanners/dependency/osv-client.js";

async function load(url: string): Promise<typeof QueryOsv> {
  vi.stubEnv("OSV_API_URL", url);
  vi.stubEnv("OSV_TIMEOUT", "2000");
  vi.resetModules();
  const mod = await import("../../../../../src/scan/scanners/dependency/osv-client.js");
  return mod.queryOsv;
}

async function listen(server: http.Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as AddressInfo).port;
}

async function close(server: http.Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

describe("queryOsv additional branches", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.doUnmock("../../../../../src/scan/config/osv.config.js");
    vi.doUnmock("node:https");
    vi.resetModules();
  });

  test("stringifies a non-Error thrown by the config loader", async () => {
    vi.resetModules();
    vi.doMock("../../../../../src/scan/config/osv.config.js", () => ({
      getOsvConfig: (): never => {
        throw "boom";
      },
    }));
    const { queryOsv } = await import("../../../../../src/scan/scanners/dependency/osv-client.js");
    expect(await queryOsv("a", "1.0.0")).toEqual({ status: "unavailable", error: "boom" });
  });

  test("ignores extra data chunks after the size limit was exceeded", async () => {
    const server = http.createServer((_req, res) => {
      res.write(Buffer.alloc(6 * 1024 * 1024, "a"));
      res.write(Buffer.alloc(1024, "a"));
      res.end();
    });
    const port = await listen(server);
    try {
      const queryOsv = await load(`http://127.0.0.1:${port}/v1/query`);
      const result = await queryOsv("big", "1.0.0");
      expect(result.status).toBe("error");
    } finally {
      await close(server);
    }
  });

  test("uses https when the configured protocol is https", async () => {
    const request = vi.fn(() => {
      throw new Error("https-used");
    });
    vi.doMock("node:https", () => ({ default: { request }, request }));
    const queryOsv = await load("https://127.0.0.1:9/v1/query");
    await expect(queryOsv("a", "1.0.0")).rejects.toThrow("https-used");
    expect(request).toHaveBeenCalledTimes(1);
  });
});
