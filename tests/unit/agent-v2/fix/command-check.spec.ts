import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { BASELINE_FAILING, CommandChecker, commandEnv, runCommand, safeOutput } from "../../../../src/agent-v2/fix/command-check.js";
import { FAKE_SECRET, nodeCmd } from "./command-helpers.js";
import { fixOf, put, tmp } from "./helpers.js";

vi.setConfig({ testTimeout: 60_000 });

const FLAG_OK = nodeCmd("process.exit(require('fs').readFileSync('flag.txt','utf8').trim()==='ok'?0:1)");
const COUNT = nodeCmd("require('fs').appendFileSync(process.env.MURAQIB_TEST_COUNTER,'x')");
const roots: string[] = [];
const saved: Record<string, string | undefined> = {};

function dir(prefix: string): string {
  const d = tmp(prefix);
  roots.push(d);
  return d;
}
function project(flag = "ok"): string {
  const root = dir("agent-v2-cmd-");
  put(root, "flag.txt", `${flag}\n`);
  return root;
}
const setFlag = (value: string): ReturnType<typeof fixOf> => fixOf({ edits: [{ file: "flag.txt", content: `${value}\n` }] });
function setEnv(name: string, value: string): void {
  if (!(name in saved)) saved[name] = process.env[name];
  process.env[name] = value;
}
const counterFile = (): string => process.env.MURAQIB_TEST_COUNTER ?? "";
const counter = (): number => (existsSync(counterFile()) ? readFileSync(counterFile(), "utf-8").length : 0);

beforeEach(() => {
  setEnv("MURAQIB_TEST_COUNTER", join(dir("agent-v2-counter-"), "count.txt"));
});
afterEach(() => {
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) Reflect.deleteProperty(process.env, name);
    else process.env[name] = value;
  }
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});
function checker(root: string, commands: string[], extra: { timeoutMs?: number; link?: (t: string, p: string) => void } = {}): CommandChecker {
  return new CommandChecker({ commands, timeoutMs: extra.timeoutMs ?? 30_000, projectRoot: root, link: extra.link });
}

describe("CommandChecker", () => {
  test("passes before and after: accepted and listed", async () => {
    const root = project();
    const result = await checker(root, [FLAG_OK]).check(root, setFlag("ok"));
    expect(result).toEqual({ ok: true, summary: { passed: [FLAG_OK], warnings: [] } });
  });

  test("passes before, fails after: rejected with reason and truncated output", async () => {
    const root = project();
    const noisy = nodeCmd("Array.from({length:30},(_, i)=>console.log('line'+(i+1)));process.exit(require('fs').readFileSync('flag.txt','utf8').trim()==='ok'?0:1)");
    const result = await checker(root, [noisy]).check(root, setFlag("bad"));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe(`verify command failed: ${noisy} (exit 1)`);
    const lines = result.output.split("\n");
    expect(lines).toHaveLength(20);
    expect(lines[0]).toBe("line11");
    expect(lines[19]).toBe("line30");
    expect(readFileSync(join(root, "flag.txt"), "utf-8")).toBe("ok\n");
  });

  test("baseline failing: command not used and fix not rejected", async () => {
    const root = project("bad");
    const result = await checker(root, [FLAG_OK]).check(root, setFlag("worse"));
    expect(result).toEqual({ ok: true, summary: { passed: [], warnings: [`${BASELINE_FAILING}: ${FLAG_OK}`] } });
  });

  test("baseline is cached across fixes", async () => {
    const root = project();
    const c = checker(root, [COUNT]);
    expect((await c.check(root, setFlag("ok"))).ok).toBe(true);
    expect((await c.check(root, setFlag("ok2"))).ok).toBe(true);
    expect(counter()).toBe(3);
  });

  test("timeout rejects, kills the process, and a timed-out baseline is 'baseline failing'", async () => {
    const root = project();
    const hang = nodeCmd("require('fs').readFileSync('flag.txt','utf8').trim()==='ok'?0:setTimeout(()=>{},60000)");
    const started = Date.now();
    const result = await checker(root, [hang], { timeoutMs: 1500 }).check(root, setFlag("bad"));
    expect(Date.now() - started).toBeLessThan(20_000);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/^verify command failed: .* \(timed out after \d+s\)$/);

    const sleeper = nodeCmd("require('fs').writeFileSync(process.env.MURAQIB_TEST_COUNTER,String(process.pid));setTimeout(()=>{},60000)");
    const run = await runCommand(sleeper, root, 1500);
    expect(run.ok).toBe(false);
    const pid = Number(readFileSync(counterFile(), "utf-8"));
    let alive = true;
    for (let i = 0; i < 40 && alive; i += 1) {
      try {
        process.kill(pid, 0);
        await new Promise((r) => setTimeout(r, 100));
      } catch {
        alive = false;
      }
    }
    expect(alive).toBe(false);

    const baseline = await checker(root, [sleeper], { timeoutMs: 1000 }).check(root, setFlag("ok"));
    expect(baseline).toEqual({ ok: true, summary: { passed: [], warnings: [`${BASELINE_FAILING}: ${sleeper}`] } });
  });

  test("output containing a secret is never shown", async () => {
    const root = project();
    const leak = nodeCmd("console.log(['sk','live','A1b2C3d4E5f6G7h8I9j0K1l2'].join('_'));console.log('token = abcdefgh12345678');console.log('plain line');process.exit(require('fs').readFileSync('flag.txt','utf8').trim()==='ok'?0:1)");
    const result = await checker(root, [leak]).check(root, setFlag("bad"));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.output).not.toContain(FAKE_SECRET);
    expect(result.output).not.toContain("abcdefgh12345678");
    expect(result.output).toContain("plain line");
    expect(result.output).toMatch(/REDACTED|\(line hidden\)/);
  });

  test("GEMINI_API_KEY and GOOGLE_API_KEY are not visible to the command", async () => {
    const root = project();
    setEnv("GEMINI_API_KEY", "fake-gemini-value");
    setEnv("GOOGLE_API_KEY", "fake-google-value");
    const probe = nodeCmd("process.exit(['GEMINI_API_KEY','GOOGLE_API_KEY'].filter(k=>k in process.env).length)");
    expect(await checker(root, [probe]).check(root, setFlag("ok"))).toEqual({ ok: true, summary: { passed: [probe], warnings: [] } });
    expect(commandEnv({ GEMINI_API_KEY: "a", GOOGLE_API_KEY: "b", KEEP: "c" })).toEqual({ KEEP: "c" });
  });

  test("node_modules of the real project is linked into the copy and survives cleanup", async () => {
    const root = project();
    put(root, "node_modules/tiny/index.js", "module.exports = 42;\n");
    const c = nodeCmd("process.exit(require('./node_modules/tiny/index.js')===42?0:1)");
    expect(await checker(root, [c]).check(root, setFlag("ok"))).toMatchObject({ ok: true, summary: { passed: [c] } });
    expect(readFileSync(join(root, "node_modules/tiny/index.js"), "utf-8")).toContain("42");
  });

  test("a failing link is reported, not thrown", async () => {
    const root = project();
    mkdirSync(join(root, "node_modules"));
    const link = (): void => {
      throw new Error("EPERM nope");
    };
    const result = await checker(root, [nodeCmd("process.exit(0)")], { link }).check(root, setFlag("ok"));
    expect(result.ok).toBe(true);
    expect(result.summary.warnings.join("\n")).toMatch(/node_modules could not be linked.*EPERM nope/);
  });

  test("several commands run in order and stop at the first failure", async () => {
    const root = project();
    const first = nodeCmd("process.exit(0)");
    const result = await checker(root, [first, FLAG_OK, COUNT]).check(root, setFlag("bad"));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain(FLAG_OK);
    expect(result.summary.passed).toEqual([first]);
    expect(counter()).toBe(1);
  });

  test("a command the shell cannot find fails", async () => {
    const run = await runCommand("muraqib-no-such-command-xyz", tmp("agent-v2-cmd-"), 10_000);
    expect(run.ok).toBe(false);
    expect(run.detail).toMatch(/^exit \d+$/);
  });
});

describe("safeOutput", () => {
  test("keeps the last 20 lines and hides secret lines", () => {
    const text = Array.from({ length: 25 }, (_, i) => `row${i + 1}`).concat(FAKE_SECRET).join("\n");
    const out = safeOutput(text).split("\n");
    expect(out).toHaveLength(20);
    expect(out.join("\n")).not.toContain(FAKE_SECRET);
    expect(out[0]).toBe("row7");
  });
});
