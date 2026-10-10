import { afterEach, describe, expect, test, vi } from "vitest";
import * as http from "node:http";
import type { AddressInfo } from "node:net";

type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => void;

async function withServer<T>(
  handler: Handler,
  run: (queryOsv: typeof import("../../src/scan/scanners/dependency/osv-client.js").queryOsv) => Promise<T>,
  timeoutMs = "2000"
): Promise<T> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  vi.stubEnv("OSV_API_URL", `http://127.0.0.1:${port}/v1/query`);
  vi.stubEnv("OSV_TIMEOUT", timeoutMs);
  vi.resetModules();
  try {
    const mod = await import("../../src/scan/scanners/dependency/osv-client.js");
    return await run(mod.queryOsv);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe("queryOsv", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  test("posts the package query and returns parsed vulnerabilities", async () => {
    let body = "";
    const result = await withServer(
      (req, res) => {
        req.on("data", (c) => (body += String(c)));
        req.on("end", () => {
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ vulns: [{ id: "GHSA-1" }] }));
        });
      },
      (queryOsv) => queryOsv("lodash", "4.17.0")
    );
    expect(JSON.parse(body)).toEqual({
      version: "4.17.0",
      package: { name: "lodash", ecosystem: "npm" },
    });
    expect(result).toEqual({ status: "success", data: { vulns: [{ id: "GHSA-1" }] } });
  });

  test("reports unavailable for non-2xx responses", async () => {
    const result = await withServer(
      (_req, res) => {
        res.statusCode = 503;
        res.end("down");
      },
      (queryOsv) => queryOsv("a", "1.0.0")
    );
    expect(result.status).toBe("unavailable");
    expect(result.status === "unavailable" && result.error).toContain("503");
  });

  test("reports an error when the body is not valid JSON", async () => {
    const result = await withServer(
      (_req, res) => res.end("not json"),
      (queryOsv) => queryOsv("a", "1.0.0")
    );
    expect(result.status).toBe("error");
  });

  test("reports a timeout when the server never answers", async () => {
    const result = await withServer(
      () => undefined,
      (queryOsv) => queryOsv("slow", "1.0.0"),
      "150"
    );
    expect(result.status).toBe("timeout");
    expect(result.status === "timeout" && result.error).toContain("slow");
  });

  test("reports unavailable on a network error", async () => {
    const server = http.createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    vi.stubEnv("OSV_API_URL", `http://127.0.0.1:${port}/v1/query`);
    vi.resetModules();
    const { queryOsv } = await import("../../src/scan/scanners/dependency/osv-client.js");
    const result = await queryOsv("a", "1.0.0");
    expect(result.status).toBe("unavailable");
  });
});
