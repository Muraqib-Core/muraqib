import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AsyncGuard, performAsyncAudit } from "./async-guard.js";

describe("async-guard patterns", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "async-guard-"));
    fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const audit = (source: string, file = "src/a.ts"): ReturnType<typeof performAsyncAudit> => {
    const full = path.join(dir, file);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, source);
    return performAsyncAudit(dir);
  };
  const codes = (source: string): string[] => audit(source).findings.map((f) => f.code);

  describe("missing await", () => {
    it("flags async function declarations", () => {
      expect(codes("async function load() { return 1; }\nfunction run() {\n  load();\n}\n")).toEqual(["ASYNC_MISSING_AWAIT"]);
    });

    it("flags async arrow functions, async function expressions and typed ones", () => {
      expect(codes("const a = async () => 1;\nlet b = async function () { return 1; };\nvar c = async x => x;\na();\nb();\nc();\n")).toEqual([
        "ASYNC_MISSING_AWAIT",
        "ASYNC_MISSING_AWAIT",
        "ASYNC_MISSING_AWAIT",
      ]);
    });

    it("handles identifiers containing $ (regex escaping)", () => {
      expect(codes("async function $load() {}\n$load();\n")).toEqual(["ASYNC_MISSING_AWAIT"]);
    });

    it("flags this.method() for async methods of the file but not obj.method()", () => {
      const source = "class A {\n  async save(): Promise<void> {}\n  run(): void {\n    this.save();\n    other.save();\n  }\n}\n";
      const findings = audit(source).findings;
      expect(findings.map((f) => f.code)).toEqual(["ASYNC_MISSING_AWAIT"]);
      expect(findings[0]?.line).toBe(4);
    });

    it("does not flag awaited, returned, assigned, void, chained or .catch calls", () => {
      const source = [
        "async function load() { return 1; }",
        "async function a() {",
        "  await load();",
        "  const x = load();",
        "  void load();",
        "  load().catch(() => undefined);",
        "  return load();",
        "  foo(load());",
        "  if (x) { }",
        "}",
      ].join("\n");
      expect(codes(source)).toEqual([]);
    });

    it("does not flag calls to non-async functions or declarations", () => {
      expect(codes("function sync() {}\nsync();\nasync function declared();\n")).toEqual([]);
    });

    it("does not treat a call on a continued line as a statement", () => {
      expect(codes("async function load() {}\nconst x =\n  load();\n")).toEqual([]);
    });
  });

  describe("floating promises", () => {
    it.each(["fetch('/a');", "axios('/a');", "axios.get('/a');", "request({});", "query('x');", "window.fetch('/a');"])(
      "flags %s",
      (statement) => {
        expect(codes(`function f() {\n  ${statement}\n}\n`)).toEqual(["ASYNC_FLOATING_PROMISE"]);
      }
    );

    it.each([
      "const x = fetch('/a');",
      "let y = fetch('/a');",
      "return fetch('/a');",
      "await fetch('/a');",
      "void fetch('/a');",
      "fetch('/a').catch(() => undefined);",
      "foo(fetch('/a'));",
      "db.query('x', cb);",
      "if (a) { }",
    ])("does not flag %s", (statement) => {
      expect(codes(`async function f() {\n  ${statement}\n}\n`).includes("ASYNC_FLOATING_PROMISE")).toBe(false);
    });

    it("does not flag multi-line assignments and chained calls", () => {
      expect(codes("function f() {\n  const x =\n    fetch('/a');\n  return x;\n}\n")).toEqual([]);
      expect(codes("function f() {\n  fetch('/a')\n    .then(r => r, e => e);\n}\n")).toEqual([]);
    });

    it("does not flag method declarations named fetch/query/request", () => {
      expect(codes("const o = {\n  query(sql: string): number {\n    return 1;\n  },\n};\n")).toEqual([]);
      expect(codes("class C {\n  async fetch(): Promise<void> {}\n  private request(a: number) {\n    return a;\n  }\n}\n")).toEqual([]);
    });
  });

  describe("promises, callbacks and chains", () => {
    it("flags new Promise that can reject, with file and line", () => {
      const result = audit("const p = new Promise((resolve, reject) => {\n  reject(1);\n});\n");
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0]).toMatchObject({ code: "ASYNC_UNHANDLED_PROMISE", severity: "error", file: "src/a.ts", line: 1 });
      expect(result.unhandledPromises).toEqual(["src/a.ts:1"]);
    });

    it("flags callback hell", () => {
      expect(codes("run(callback, (a) => f(g(h(callback))));\n")).toEqual(["ASYNC_CALLBACK_HELL"]);
    });

    it("flags .then without catch as a warning and accepts a catch", () => {
      const bad = audit("load().then(use);\n").findings;
      expect(bad).toMatchObject([{ code: "ASYNC_THEN_WITHOUT_CATCH", severity: "warning" }]);
      expect(codes("load().then(use).catch(log);\n")).toEqual([]);
    });
  });

  describe("guard mapping and scanning", () => {
    it("maps findings to stable codes, severities and locations (no path in code)", async () => {
      fs.writeFileSync(path.join(dir, "src", "weird-File.ts"), "function f() {\n  fetch('/a');\n  load().then(use);\n}\n");
      const result = await new AsyncGuard({ targetPath: dir }).execute();
      expect(result.issues.map((i) => i.code)).toEqual(["ASYNC_FLOATING_PROMISE", "ASYNC_THEN_WITHOUT_CATCH"]);
      expect(result.issues.map((i) => i.severity)).toEqual(["error", "warning"]);
      expect(result.issues[0]?.location).toEqual({ file: "src/weird-File.ts", line: 2 });
    });

    it("skips the guard implementation files regardless of path separators", () => {
      const source = "fetch('/a');\n";
      expect(audit(source, "src/core/async-guard.ts").isClean).toBe(true);
      expect(audit(source, "src/core/security-guard.ts").isClean).toBe(true);
    });

    it("keeps reports in sync with findings", () => {
      const result = audit("function f() {\n  fetch('/a');\n}\n");
      expect(result.reports).toEqual(result.findings.map((f) => f.message));
      expect(result.isClean).toBe(false);
    });
  });
});
