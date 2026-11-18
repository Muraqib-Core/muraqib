import { EventEmitter } from "node:events";
import { beforeEach, describe, it, expect, vi } from "vitest";

const mocks = vi.hoisted(() => ({ httpsGet: vi.fn(), tlsConnect: vi.fn() }));

vi.mock("https", () => ({ default: { get: mocks.httpsGet } }));
vi.mock("tls", () => ({ default: { connect: mocks.tlsConnect } }));

import { probeHttp } from "../../../src/core/performance/http-probe.js";

class FakeRequest extends EventEmitter {
  destroy = vi.fn((error?: Error) => { if (error) queueMicrotask(() => this.emit("error", error)); });
}

class FakeSocket extends EventEmitter {
  alpnProtocol: string | false = false;
  end = vi.fn();
  destroy = vi.fn((error?: Error) => { if (error) queueMicrotask(() => this.emit("error", error)); });
}

function respondWith(headers: Record<string, string[]>, httpVersion = "1.1"): FakeRequest {
  const req = new FakeRequest();
  const res = Object.assign(new EventEmitter(), { httpVersion, headers, resume: vi.fn() });
  mocks.httpsGet.mockImplementation(() => {
    queueMicrotask(() => req.emit("response", res));
    return req;
  });
  return req;
}

function negotiate(alpn: string | false): FakeSocket {
  const socket = new FakeSocket();
  socket.alpnProtocol = alpn;
  mocks.tlsConnect.mockImplementation(() => {
    queueMicrotask(() => socket.emit("secureConnect"));
    return socket;
  });
  return socket;
}

describe("probeHttp over HTTPS", () => {
  beforeEach(() => {
    mocks.httpsGet.mockReset();
    mocks.tlsConnect.mockReset();
  });

  it("reports HTTP/2 when ALPN selects h2 and closes the probe socket", async () => {
    respondWith({ "set-cookie": ["a=1; Path=/", "bb=22"] });
    const socket = negotiate("h2");
    const result = await probeHttp("https://example.test:8443/");
    expect(result).toEqual({ reachable: true, protocol: "HTTP/2", cookiesSizeBytes: "a=1".length + "bb=22".length });
    expect(socket.end).toHaveBeenCalled();
    expect(mocks.tlsConnect).toHaveBeenCalledWith(
      expect.objectContaining({ host: "example.test", port: 8443, servername: "example.test", ALPNProtocols: ["h2", "http/1.1"] })
    );
  });

  it("defaults to port 443", async () => {
    respondWith({});
    negotiate("h2");
    await probeHttp("https://example.test/");
    expect(mocks.tlsConnect).toHaveBeenCalledWith(expect.objectContaining({ port: 443 }));
  });

  it("keeps the HTTP version reported by the response when ALPN picks http/1.1", async () => {
    respondWith({}, "1.1");
    negotiate("http/1.1");
    expect((await probeHttp("https://example.test/")).protocol).toBe("HTTP/1.1");
  });

  it("treats a missing ALPN result as not HTTP/2", async () => {
    respondWith({}, "1.0");
    negotiate(false);
    expect((await probeHttp("https://example.test/")).protocol).toBe("HTTP/1.0");
  });

  it("reports unreachable when the TLS handshake fails", async () => {
    respondWith({});
    const socket = new FakeSocket();
    mocks.tlsConnect.mockImplementation(() => {
      queueMicrotask(() => socket.emit("error", new Error("handshake failed")));
      return socket;
    });
    const result = await probeHttp("https://example.test/");
    expect(result).toMatchObject({ reachable: false, protocol: "unknown", error: "handshake failed" });
  });

  it("destroys the TLS socket on timeout", async () => {
    respondWith({});
    const socket = new FakeSocket();
    mocks.tlsConnect.mockImplementation(() => {
      queueMicrotask(() => socket.emit("timeout"));
      return socket;
    });
    const result = await probeHttp("https://example.test/");
    expect(socket.destroy).toHaveBeenCalled();
    expect(result).toMatchObject({ reachable: false, error: "TLS handshake timed out" });
  });

  it("destroys the request on timeout", async () => {
    const req = new FakeRequest();
    mocks.httpsGet.mockImplementation(() => {
      queueMicrotask(() => req.emit("timeout"));
      return req;
    });
    const result = await probeHttp("https://example.test/");
    expect(req.destroy).toHaveBeenCalled();
    expect(result).toMatchObject({ reachable: false, error: "Request timed out" });
  });

  it("stringifies non-Error failures", async () => {
    mocks.httpsGet.mockImplementation(() => { throw "denied"; });
    expect(await probeHttp("https://example.test/")).toMatchObject({ reachable: false, error: "denied" });
  });
});
