import { existsSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import { applyEdits, resolveInside } from "../../../../src/agent-v2/fix/project-copy.js";
import { stableKey, verifyFix, type VerifyDeps } from "../../../../src/agent-v2/fix/verify.js";
import type { AgentIssue } from "../../../../src/agent/types.js";
import { BAD_SRC, GOOD_SRC, badProject, fixContent, fixOf, hashTree, issue, tmp } from "./helpers.js";
import { rmSync } from "node:fs";

// os.tmpdir() reads TMPDIR on Linux/macOS but TEMP or TMP on Windows, so all three are isolated.
const TMP_VARS = ["TMPDIR", "TMP", "TEMP"] as const;
const savedTmp = TMP_VARS.map((name) => process.env[name]);
let privateTmp = "";
const roots: string[] = [];
beforeAll(() => {
  privateTmp = tmp("agent-v2-verify-tmp-");
  for (const name of TMP_VARS) process.env[name] = privateTmp;
});
afterAll(() => {
  TMP_VARS.forEach((name, i) => {
    const saved = savedTmp[i];
    if (saved === undefined) delete process.env[name];
    else process.env[name] = saved;
  });
  rmSync(privateTmp, { recursive: true, force: true });
});
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

function project(): string {
  const root = badProject();
  roots.push(root);
  return root;
}

/** Fake audit: one issue per line containing BAD in src/a.ts, line number in the message. */
const lineCollect: VerifyDeps["collect"] = async (root) => {
  const lines = readFileSync(join(root, "src/a.ts"), "utf-8").split("\n");
  const out: AgentIssue[] = [];
  lines.forEach((l, i) => {
    if (l.includes("BAD")) out.push(issue("bad", `Found BAD at src/a.ts:${i + 1}`));
  });
  return out;
};

function badFile(root: string): void {
  applyEdits(root, [{ file: "src/a.ts", content: "// x\nBAD\n" }]);
}

describe("stableKey", () => {
  test("ignores line numbers", () => {
    const a = stableKey(issue("1", "Missing await: src/a.ts:3 — f()"));
    const b = stableKey(issue("2", "Missing await: src/a.ts:42:7 — f()"));
    expect(a).toBe(b);
    expect(stableKey(issue("1", "error at line 5"))).toBe(stableKey(issue("1", "error at line 99")));
  });
  test("differs on module, code, file or message", () => {
    const base = stableKey(issue("1", "x"));
    expect(stableKey(issue("1", "y"))).not.toBe(base);
    expect(stableKey(issue("1", "x", { code: "D" }))).not.toBe(base);
    expect(stableKey(issue("1", "x", { file: "src/b.ts" }))).not.toBe(base);
    expect(stableKey(issue("1", "x", { module: "n" }))).not.toBe(base);
  });
});

describe("verifyFix with an injected collect", () => {
  test("accepted when the target disappears and nothing new appears", async () => {
    const root = project();
    badFile(root);
    const out = await verifyFix(root, fixOf({ resolves: ["bad"], edits: [{ file: "src/a.ts", content: "ok\n" }] }), { collect: lineCollect });
    expect(out).toEqual({ accepted: true, resolved: 1 });
  });

  test("line shifts alone do not count as new issues", async () => {
    const root = project();
    badFile(root);
    const out = await verifyFix(root, fixOf({ resolves: [], edits: [{ file: "src/a.ts", content: "// a\n// b\n// c\n// x\nBAD\n" }] }), { collect: lineCollect });
    expect(out.accepted).toBe(true);
  });

  test("rejected when the issue is still present", async () => {
    const root = project();
    badFile(root);
    const out = await verifyFix(root, fixOf({ resolves: ["bad"], edits: [{ file: "src/a.ts", content: "BAD\n" }] }), { collect: lineCollect });
    expect(out.accepted).toBe(false);
    if (!out.accepted) {
      expect(out.reason).toContain("still reported");
      expect(out.stillPresent).toHaveLength(1);
    }
  });

  test("rejected when a new issue (different key) appears", async () => {
    const root = project();
    const collect: VerifyDeps["collect"] = async (r) => {
      const text = readFileSync(join(r, "src/a.ts"), "utf-8");
      return text.includes("NEW") ? [issue("n", "brand new problem")] : [issue("t", "target problem")];
    };
    const out = await verifyFix(root, fixOf({ resolves: ["t"], edits: [{ file: "src/a.ts", content: "NEW\n" }] }), { collect });
    expect(out.accepted).toBe(false);
    if (!out.accepted) {
      expect(out.introduced).toHaveLength(1);
      expect(out.stillPresent).toHaveLength(0);
      expect(out.reason).toContain("introduces");
    }
  });

  test("rejected when the count of an existing issue goes up", async () => {
    const root = project();
    let call = 0;
    const collect: VerifyDeps["collect"] = async () => {
      call += 1;
      return call === 1 ? [issue("t", "target"), issue("y", "other")] : [issue("y", "other"), issue("y2", "other")];
    };
    const out = await verifyFix(root, fixOf({ resolves: ["t"], edits: [{ file: "src/a.ts", content: "z\n" }] }), { collect });
    expect(out.accepted).toBe(false);
    if (!out.accepted) expect(out.introduced).toHaveLength(1);
  });

  test("duplicates are counted per key", async () => {
    const root = project();
    const run = async (afterCount: number): Promise<boolean> => {
      let call = 0;
      const collect: VerifyDeps["collect"] = async () => {
        call += 1;
        const n = call === 1 ? 2 : afterCount;
        return Array.from({ length: n }, () => issue("t", "dup"));
      };
      return (await verifyFix(root, fixOf({ resolves: ["t"], edits: [{ file: "src/a.ts", content: "z\n" }] }), { collect })).accepted;
    };
    expect(await run(0)).toBe(true);
    expect(await run(1)).toBe(false);
    expect(await run(2)).toBe(false);
  });

  test("a crash in collect is a rejection, not a throw", async () => {
    const root = project();
    const out = await verifyFix(root, fixOf({ edits: [] }), {
      collect: async () => {
        throw new Error("boom");
      },
    });
    expect(out.accepted).toBe(false);
    if (!out.accepted) expect(out.reason).toContain("boom");
  });

  test("never modifies the real project and removes its temp copy", async () => {
    const root = project();
    const before = hashTree(root);
    const leftoverBefore = readdirSync(tmpdir()).filter((n) => n.startsWith("muraqib-agent-copy-"));
    expect(leftoverBefore).toEqual([]);
    await verifyFix(root, fixOf({ resolves: [], edits: [{ file: "src/a.ts", content: "changed\n" }, { file: "src/new.ts", content: "n\n" }] }), { collect: async () => [] });
    await verifyFix(root, fixOf({ edits: [] }), {
      collect: async () => {
        throw new Error("x");
      },
    });
    expect(hashTree(root)).toBe(before);
    expect(existsSync(join(root, "src/new.ts"))).toBe(false);
    expect(readdirSync(tmpdir()).filter((n) => n.startsWith("muraqib-agent-copy-"))).toEqual([]);
  });
});

describe("path escapes", () => {
  test("resolveInside and applyEdits refuse relative escapes and absolute paths", () => {
    const root = project();
    expect(() => resolveInside(root, "../x")).toThrow(/escapes/);
    expect(() => resolveInside(root, "src/../../x")).toThrow(/escapes/);
    expect(() => resolveInside(root, "/etc/passwd")).toThrow(/relative/);
    expect(() => resolveInside(root, "")).toThrow();
    expect(() => applyEdits(root, [{ file: "../x", content: "c" }])).toThrow();
    expect(() => applyEdits(root, [{ file: "/tmp/abs-should-not-exist", content: "c" }])).toThrow();
    expect(resolveInside(root, "src/ok.ts")).toBe(join(root, "src/ok.ts"));
  });

  test("verifyFix rejects an escaping edit and writes nothing outside", async () => {
    const root = project();
    const out = await verifyFix(root, fixOf({ edits: [{ file: "../escaped.txt", content: "c" }] }), { collect: async () => [] });
    expect(out.accepted).toBe(false);
    if (!out.accepted) expect(out.reason).toMatch(/escapes/);
    const abs = await verifyFix(root, fixOf({ edits: [{ file: "/tmp/abs-should-not-exist", content: "c" }] }), { collect: async () => [] });
    expect(abs.accepted).toBe(false);
    expect(existsSync("/tmp/abs-should-not-exist")).toBe(false);
  });
});

describe("verifyFix with the real audit", () => {
  test("accepts the real fix of a floating call", async () => {
    const root = project();
    const { collectIssues } = await import("../../../../src/agent-v2/planner.js");
    const collected = await collectIssues(root);
    if (!collected.ok) throw new Error(collected.error);
    const target = collected.issues.find((i) => i.code === "ASYNC_MISSING_AWAIT");
    expect(target).toBeDefined();
    const before = hashTree(root);
    const out = await verifyFix(root, fixOf({ resolves: [target?.id ?? ""], edits: [{ file: "src/a.ts", content: fixContent(BAD_SRC) }] }));
    expect(out.accepted).toBe(true);
    expect(fixContentSanity()).toBe(GOOD_SRC);
    expect(hashTree(root)).toBe(before);
  });

  test("rejects a no-op edit against the real audit", async () => {
    const root = project();
    const { collectIssues } = await import("../../../../src/agent-v2/planner.js");
    const collected = await collectIssues(root);
    if (!collected.ok) throw new Error(collected.error);
    const target = collected.issues.find((i) => i.code === "ASYNC_MISSING_AWAIT");
    const out = await verifyFix(root, fixOf({ resolves: [target?.id ?? ""], edits: [{ file: "src/a.ts", content: `${BAD_SRC}// more\n` }] }));
    expect(out.accepted).toBe(false);
  });

  test("rejects an edit that adds a new real issue", async () => {
    const root = project();
    const { collectIssues } = await import("../../../../src/agent-v2/planner.js");
    const collected = await collectIssues(root);
    if (!collected.ok) throw new Error(collected.error);
    const target = collected.issues.find((i) => i.code === "ASYNC_MISSING_AWAIT");
    // fixes a.ts but adds another floating call in a new file
    const out = await verifyFix(root, fixOf({ resolves: [target?.id ?? ""], edits: [{ file: "src/a.ts", content: GOOD_SRC }, { file: "src/b.ts", content: BAD_SRC }] }));
    expect(out.accepted).toBe(false);
    if (!out.accepted) expect(out.introduced.length).toBeGreaterThan(0);
  });
});

function fixContentSanity(): string {
  return fixContent(BAD_SRC);
}
