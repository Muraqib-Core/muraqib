import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const exec = vi.hoisted(() => vi.fn());
vi.mock("child_process", () => ({ execFileSync: exec }));

import { buildAuditContext, resetNpmVersionCache } from "./audit-context.js";

const saved = { CI: process.env.CI, NODE_ENV: process.env.NODE_ENV };
beforeEach(() => {
  exec.mockReset();
  exec.mockImplementation(() => Buffer.from("1.2.3\n"));
  resetNpmVersionCache();
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  vi.restoreAllMocks();
});

describe("buildAuditContext environment", () => {
  it.each(["", "0", "false", "FALSE", " False "])("CI=%j is not CI", (v) => {
    process.env.CI = v;
    process.env.NODE_ENV = "development";
    expect(buildAuditContext("/tmp").environment).toBe("development");
  });
  it.each(["1", "true", "yes"])("CI=%s is ci", (v) => {
    process.env.CI = v;
    expect(buildAuditContext("/tmp").environment).toBe("ci");
  });
  it("unset CI + production", () => {
    delete process.env.CI;
    process.env.NODE_ENV = "production";
    expect(buildAuditContext("/tmp").environment).toBe("production");
  });
});

describe("buildAuditContext probing", () => {
  it("caches npm version across calls but not git", () => {
    buildAuditContext("/a");
    buildAuditContext("/b");
    const npmCalls = exec.mock.calls.filter((c) => String(c[0]).startsWith("npm"));
    const gitCalls = exec.mock.calls.filter((c) => c[0] === "git");
    expect(npmCalls).toHaveLength(1);
    expect(gitCalls).toHaveLength(4);
    expect(buildAuditContext("/c").npmVersion).toBe("1.2.3");
  });
  it("uses npm.cmd with shell on win32 and keeps timeout", () => {
    const orig = Object.getOwnPropertyDescriptor(process, "platform")!;
    Object.defineProperty(process, "platform", { value: "win32" });
    try {
      buildAuditContext("/a");
    } finally {
      Object.defineProperty(process, "platform", orig);
    }
    const call = exec.mock.calls.find((c) => c[0] === "npm.cmd");
    expect(call).toBeDefined();
    expect(call?.[2]).toMatchObject({ shell: true, timeout: 5000 });
  });
  it("falls back to unknown/undefined when probes fail and does not cache failure", () => {
    exec.mockImplementation(() => { throw new Error("nope"); });
    const ctx = buildAuditContext("/a");
    expect(ctx.npmVersion).toBe("unknown");
    expect(ctx.gitBranch).toBeUndefined();
    buildAuditContext("/a");
    expect(exec.mock.calls.filter((c) => String(c[0]).startsWith("npm"))).toHaveLength(2);
  });
});
