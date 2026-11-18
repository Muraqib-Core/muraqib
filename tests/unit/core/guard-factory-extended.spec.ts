import { describe, it, expect } from "vitest";
import { GuardFactory } from "../../../src/core/guard-factory.js";
import type { AuditContext } from "../../../src/core/types.js";

const ctx: AuditContext = { projectRoot: "/tmp", timestamp: 0, environment: "development", nodeVersion: "v20", npmVersion: "10" };

describe("GuardFactory", () => {
  const f = GuardFactory.create(ctx);
  it("creates memory + compatibility guards by default", () => {
    expect(f.createAllGuards({}).map((g) => g.getModule())).toEqual(["memory-guard", "compatibility-guard"]);
  });
  it("adds optional guards when targets are given", () => {
    const names = f.createAllGuards({ asyncTargetPath: "a", deadCodeTargetPath: "d" }).map((g) => g.getModule());
    expect(names).toContain("async-guard");
    expect(names).toContain("dead-code-guard");
  });
  it("narrows untyped memory options to known numeric keys", async () => {
    const guard = f.createMemoryGuard({ heapWarnMb: 0, heapCriticalMb: 0, bogus: 1, rssWarnMb: "x" });
    const res = await guard.run();
    expect(res.module).toBe("memory-guard");
    expect(res.issues.some((i) => i.severity === "critical" || i.severity === "warning" || i.severity === "error")).toBe(true);
  });
  it("accepts typed options and none", async () => {
    expect((await f.createMemoryGuard({ heapWarnMb: 100000, heapCriticalMb: 200000, rssWarnMb: 100000 }).run()).module).toBe("memory-guard");
    expect(f.createMemoryGuard()).toBeDefined();
  });
});
