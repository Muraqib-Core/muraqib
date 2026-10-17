import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { prePushVerdict, renderPrePushReport, renderPreCommitReport, runPreCommit, runPrePush } from "../../../src/hooks/run.js";
import type { HookIo, PrePushAudit } from "../../../src/hooks/run.js";
import type { AuditIssue, AuditResult, ScanAuditMetadata } from "../../../src/core/types.js";
import { SKIP_ENV } from "../../../src/hooks/hook-script.js";
import { git, initRepo, isolateGit, write } from "./git-fixture.js";

let restore: () => void;
beforeAll(() => {
  restore = isolateGit();
});
afterAll(() => restore());

const STRIPE = `sk_live_${"aB3".repeat(8)}`;
const PUBLISHABLE = `pk_live_${"aB3".repeat(8)}`;

function capture(): { io: HookIo; err: string[]; out: string[] } {
  const err: string[] = [];
  const out: string[] = [];
  return { io: { err: (m) => void err.push(m), out: (m) => void out.push(m) }, err, out };
}

function stage(repo: string, files: Record<string, string>): void {
  for (const [file, content] of Object.entries(files)) write(repo, file, content);
  git(repo, "add", "-A");
}

describe("runPreCommit", () => {
  test("blocks a commit that stages a secret, pointing at file and line without printing the secret", async () => {
    const repo = initRepo();
    stage(repo, { "src/pay.ts": `// pay\nconst key = "${STRIPE}";\n` });
    const { io, err } = capture();
    expect(await runPreCommit(repo, {}, io)).toBe(1);
    const output = err.join("\n");
    expect(output).toContain("commit blocked, 1 secret(s)");
    expect(output).toContain("src/pay.ts:2");
    expect(output).toContain("muraqib-ignore-secret");
    expect(output).not.toContain(STRIPE);
  });

  test("allows a clean commit silently", async () => {
    const repo = initRepo();
    stage(repo, { "a.ts": "export const a = 1;\n" });
    const { io, err, out } = capture();
    expect(await runPreCommit(repo, {}, io)).toBe(0);
    expect([...err, ...out]).toEqual([]);
  });

  test("allows a commit with nothing staged", async () => {
    expect(await runPreCommit(initRepo(), {}, capture().io)).toBe(0);
  });

  test("scans the staged content, not the working tree", async () => {
    const repo = initRepo();
    stage(repo, { "a.ts": `const key = "${STRIPE}";\n` });
    write(repo, "a.ts", "const key = process.env.KEY;\n");
    expect(await runPreCommit(repo, {}, capture().io)).toBe(1);

    const other = initRepo();
    stage(other, { "a.ts": "const key = process.env.KEY;\n" });
    write(other, "a.ts", `const key = "${STRIPE}";\n`);
    expect(await runPreCommit(other, {}, capture().io)).toBe(0);
  });

  test("ignores secrets that were committed earlier and untouched lines", async () => {
    const repo = initRepo();
    write(repo, "legacy.ts", `const key = "${STRIPE}";\nconst a = 1;\n`);
    git(repo, "add", "-A");
    git(repo, "commit", "-qm", "legacy");
    write(repo, "legacy.ts", `const key = "${STRIPE}";\nconst a = 2;\n`);
    git(repo, "add", "-A");
    expect(await runPreCommit(repo, {}, capture().io)).toBe(0);
  });

  test("an inline muraqib-ignore-secret marker acknowledges a false positive", async () => {
    const repo = initRepo();
    stage(repo, { "a.ts": `const key = "${STRIPE}"; // muraqib-ignore-secret\n` });
    expect(await runPreCommit(repo, {}, capture().io)).toBe(0);
  });

  test("blocks a staged .env with a real secret but not a template", async () => {
    const repo = initRepo();
    stage(repo, { ".env.example": "API_TOKEN=Zq8rT2vLmN4xPw7Yb3KcHd9Ge5Fs\n" });
    expect(await runPreCommit(repo, {}, capture().io)).toBe(0);
    stage(repo, { ".env": "API_TOKEN=Zq8rT2vLmN4xPw7Yb3KcHd9Ge5Fs\n" });
    const { io, err } = capture();
    expect(await runPreCommit(repo, {}, io)).toBe(1);
    expect(err.join("\n")).not.toContain("Zq8rT2vLmN4xPw7Yb3KcHd9Ge5Fs");
  });

  test("warns about ambiguous findings without blocking", async () => {
    const repo = initRepo();
    stage(repo, { "a.ts": `const publishable = "${PUBLISHABLE}";\n` });
    const { io, err } = capture();
    expect(await runPreCommit(repo, {}, io)).toBe(0);
    expect(err.join("\n")).toContain("1 possible secret(s) in the staged changes (not blocking)");
    expect(err.join("\n")).not.toContain("Remove the secret");
  });

  test(`${SKIP_ENV} skips the check`, async () => {
    const repo = initRepo();
    stage(repo, { "a.ts": `const key = "${STRIPE}";\n` });
    expect(await runPreCommit(repo, { [SKIP_ENV]: "1" }, capture().io)).toBe(0);
  });

  test("when git cannot read the index it warns and allows instead of trapping the developer", async () => {
    const repo = initRepo();
    stage(repo, { "a.ts": "export const a = 1;\n" });
    write(repo, ".git/index", "this is not an index");
    const { io, err } = capture();
    expect(await runPreCommit(repo, {}, io)).toBe(0);
    expect(err.join("\n")).toContain("could not check the staged changes");
  });

  test("outside a git repository it warns and allows", async () => {
    const { io, err } = capture();
    expect(await runPreCommit("/", {}, io)).toBe(0);
    expect(err.join("\n")).toContain("not inside a git repository");
  });

  test("stays well under a second on a large staged change", async () => {
    const repo = initRepo();
    const lines = Array.from({ length: 20_000 }, (_, i) => `export const value${i} = compute(${i}, "item-${i}"); // order 2024-05-${i % 28}`);
    stage(repo, { "big.ts": `${lines.join("\n")}\n`, "docs/readme.md": "# docs\n".repeat(2000) });
    const started = performance.now();
    expect(await runPreCommit(repo, {}, capture().io)).toBe(0);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});

describe("renderPreCommitReport", () => {
  test("is empty when nothing was found", () => {
    expect(renderPreCommitReport({ status: "ok", module: "secret-guard", issues: [], message: "", timestamp: 0, duration: 0 })).toEqual([]);
  });
});

const issue = (severity: AuditIssue["severity"], code = "X", extra: Partial<AuditIssue> = {}): AuditIssue => ({
  code,
  severity,
  title: `title ${code}`,
  message: `message ${code}`,
  tags: [],
  ...extra,
});

const result = (module: string, issues: AuditIssue[], scan?: Partial<ScanAuditMetadata>): AuditResult => ({
  status: "issues",
  module,
  issues,
  message: "",
  timestamp: 0,
  duration: 0,
  ...(scan ? { scan: { mode: "build", exitCode: 0, hasBlockingIssues: false, scannerCoverage: [], ...scan } } : {}),
});

describe("prePushVerdict", () => {
  test("is clean when nothing is found", () => {
    expect(prePushVerdict([])).toEqual({ exitCode: 0, blocking: [], otherCount: 0 });
    expect(prePushVerdict([result("config-guard", [])]).exitCode).toBe(0);
  });

  test("critical and error findings from the scan layer block", () => {
    const vulnerable = issue("error", "OSV-1", { module: "scan" });
    const verdict = prePushVerdict([result("scan", [vulnerable, issue("warning", "W"), issue("info", "I")], { exitCode: 1, hasBlockingIssues: true })]);
    expect(verdict).toMatchObject({ exitCode: 1, blocking: [vulnerable], otherCount: 2 });
  });

  test("config-guard blocks only for leaked secrets, never for project hygiene", () => {
    const leaked = issue("critical", "CONFIG_EXPOSED_SECRET");
    const tracked = issue("error", "CONFIG_TRACKED_ENV_FILE");
    expect(prePushVerdict([result("config-guard", [leaked, tracked])]).blocking).toEqual([leaked, tracked]);
    const hygiene = prePushVerdict([result("config-guard", [issue("error", "CONFIG_MISSING_CONFIG"), issue("critical", "CONFIG_UNSAFE_SETTING")])]);
    expect(hygiene).toMatchObject({ exitCode: 0, blocking: [], otherCount: 2 });
  });

  test("warnings from the scan layer do not block", () => {
    expect(prePushVerdict([result("scan", [issue("warning", "W")])]).exitCode).toBe(0);
  });

  test("a failed scanner is exit 3 (allowed) unless there are also blocking findings", () => {
    expect(prePushVerdict([result("scan", [], { exitCode: 3 })]).exitCode).toBe(3);
    expect(prePushVerdict([result("scan", [issue("error", "E")], { exitCode: 3 })]).exitCode).toBe(1);
  });
});

describe("renderPrePushReport", () => {
  test("lists blocking findings with their module and location", () => {
    const lines = renderPrePushReport({
      exitCode: 1,
      blocking: [issue("error", "OSV-1", { module: "scan", location: { file: "package.json", line: 3 } })],
      otherCount: 2,
    });
    expect(lines[0]).toBe("muraqib: push blocked, 1 security finding(s):");
    expect(lines[1]).toBe("  ✖ [scan] title OSV-1 (package.json:3): message OSV-1");
    expect(lines).toContain("Fix them, or bypass once with `git push --no-verify`.");
    expect(lines[lines.length - 1]).toContain("2 other finding(s) do not block the push");
  });

  test("says nothing for a clean audit and warns for an incomplete one", () => {
    expect(renderPrePushReport({ exitCode: 0, blocking: [], otherCount: 0 })).toEqual([]);
    expect(renderPrePushReport({ exitCode: 3, blocking: [], otherCount: 0 })[0]).toContain("could not complete");
  });
});

describe("runPrePush", () => {
  const repo = (): string => initRepo();
  const passing: PrePushAudit = async () => [result("scan", [])];
  const blocking: PrePushAudit = async () => [result("scan", [issue("error", "OSV-1", { module: "scan" })], { exitCode: 1, hasBlockingIssues: true })];

  test("runs the audit on the repository root and allows the push when it passes", async () => {
    const root = repo();
    let seen = "";
    const { io, err } = capture();
    expect(await runPrePush(root, {}, io, async (gitRoot) => ((seen = gitRoot), [result("scan", [])]))).toBe(0);
    expect(seen).toBe(root);
    expect(err).toEqual([]);
  });

  test("blocks the push on a security finding", async () => {
    const { io, err } = capture();
    expect(await runPrePush(repo(), {}, io, blocking)).toBe(1);
    expect(err.join("\n")).toContain("push blocked, 1 security finding(s)");
  });

  test("an incomplete scan (e.g. offline) warns but does not block", async () => {
    const { io, err } = capture();
    expect(await runPrePush(repo(), {}, io, async () => [result("scan", [], { exitCode: 3 })])).toBe(0);
    expect(err.join("\n")).toContain("could not complete");
  });

  test("an audit that crashes does not block the push", async () => {
    const { io, err } = capture();
    expect(await runPrePush(repo(), {}, io, async () => Promise.reject(new Error("boom")))).toBe(0);
    expect(err.join("\n")).toContain("boom");
  });

  test(`${SKIP_ENV} skips the audit`, async () => {
    let called = false;
    expect(await runPrePush(repo(), { [SKIP_ENV]: "1" }, capture().io, async () => ((called = true), []))).toBe(0);
    expect(called).toBe(false);
  });

  test("outside a git repository it warns and allows", async () => {
    expect(await runPrePush("/", {}, capture().io, blocking)).toBe(0);
    expect(await runPrePush("/", {}, capture().io, passing)).toBe(0);
  });

  test("the default audit really runs config-guard and the scan layer (offline-safe project)", async () => {
    const root = repo();
    write(root, "package.json", JSON.stringify({ name: "demo", version: "1.0.0" }));
    const { io, err } = capture();
    expect(await runPrePush(root, {}, io)).toBe(0);
    expect(err.join("\n")).toContain("other finding(s) do not block the push");
  }, 60_000);
});
