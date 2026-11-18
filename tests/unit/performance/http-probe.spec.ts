import { afterEach, describe, it, expect } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { probeHttp } from "../../../src/core/performance/http-probe.js";

const servers: http.Server[] = [];

async function serve(handler: http.RequestListener): Promise<string> {
  const server = http.createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((resolve) => { s.closeAllConnections(); s.close(() => resolve()); })));
});

describe("probeHttp", () => {
  it("reports the negotiated protocol of a reachable plain-HTTP server", async () => {
    const url = await serve((_req, res) => { res.end("ok"); });
    const result = await probeHttp(url);
    expect(result).toEqual({ reachable: true, protocol: "HTTP/1.1", cookiesSizeBytes: 0 });
  });

  it("sums the name=value bytes of every Set-Cookie header, ignoring attributes", async () => {
    const url = await serve((_req, res) => {
      res.setHeader("Set-Cookie", ["sid=abc123; Path=/; HttpOnly", "theme=dark; Max-Age=60"]);
      res.end();
    });
    const result = await probeHttp(url);
    expect(result.reachable).toBe(true);
    expect(result.cookiesSizeBytes).toBe("sid=abc123".length + "theme=dark".length);
  });

  it("still succeeds when the response is a redirect or error status", async () => {
    const url = await serve((_req, res) => { res.statusCode = 500; res.end(); });
    expect((await probeHttp(url)).reachable).toBe(true);
  });

  it("marks a closed port as unreachable with an error message", async () => {
    const url = await serve((_req, res) => { res.end(); });
    await new Promise<void>((resolve) => servers.pop()?.close(() => resolve()));
    const result = await probeHttp(url);
    expect(result.reachable).toBe(false);
    expect(result.protocol).toBe("unknown");
    expect(result.cookiesSizeBytes).toBe(0);
    expect(result.error).toBeTruthy();
  });

  it("marks an invalid URL as unreachable", async () => {
    const result = await probeHttp("not a url");
    expect(result.reachable).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("marks an unsupported protocol as unreachable", async () => {
    const result = await probeHttp("ftp://127.0.0.1/");
    expect(result.reachable).toBe(false);
  });

  it("reports a failed TLS handshake against a non-TLS server as unreachable", async () => {
    // Plain HTTP server answering an https:// request: the request itself fails.
    const url = (await serve((_req, res) => { res.end(); })).replace("http://", "https://");
    const result = await probeHttp(url);
    expect(result.reachable).toBe(false);
    expect(result.error).toBeTruthy();
  });
});
