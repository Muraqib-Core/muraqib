import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { collectReportedFiles, mapIssuesToDiagnostics, toDiagnosticLevel } from "../src/core/diagnostics.js";
import { makeIssue, makeReport } from "./fixtures.js";

const ROOT = "/work/project";

describe("toDiagnosticLevel", () => {
  it("maps severities to Problems-panel levels", () => {
    expect(toDiagnosticLevel("critical")).toBe("error");
    expect(toDiagnosticLevel("error")).toBe("error");
    expect(toDiagnosticLevel("warning")).toBe("warning");
    expect(toDiagnosticLevel("info")).toBe("information");
    expect(toDiagnosticLevel("nope" as never)).toBe("information");
  });
});

describe("mapIssuesToDiagnostics", () => {
  it("groups by absolute path with zero-based positions", () => {
    const map = mapIssuesToDiagnostics(
      makeReport({
        issues: [
          makeIssue({ id: "a", file: "src/a.ts", line: 10, column: 4, severity: "critical", title: "RCE", message: "bad", recommendation: "fix it" }),
          makeIssue({ id: "b", file: "src/a.ts", line: 2, column: undefined as never, severity: "warning" }),
          makeIssue({ id: "c", file: "/work/project/lib/b.ts", line: undefined as never, column: undefined as never, severity: "info" }),
        ],
      }),
      ROOT,
      path.posix
    );
    expect([...map.keys()]).toEqual(["/work/project/src/a.ts", "/work/project/lib/b.ts"]);
    const [first, second] = map.get("/work/project/src/a.ts") ?? [];
    expect(first).toMatchObject({ line: 9, column: 3, level: "error", code: "SEC001", module: "security", issueId: "a" });
    expect(first?.message).toBe("RCE: bad\nfix it");
    expect(second).toMatchObject({ line: 1, column: 0, level: "warning" });
    expect(map.get("/work/project/lib/b.ts")?.[0]).toMatchObject({ line: 0, column: 0, level: "information" });
  });

  it("skips issues without a file and files outside the workspace", () => {
    const map = mapIssuesToDiagnostics(
      makeReport({
        issues: [
          makeIssue({ id: "1", file: undefined as never }),
          makeIssue({ id: "2", file: "../../etc/passwd" }),
          makeIssue({ id: "3", file: "/etc/shadow" }),
          makeIssue({ id: "4", file: "ok.ts" }),
        ],
      }),
      ROOT,
      path.posix
    );
    expect([...map.keys()]).toEqual(["/work/project/ok.ts"]);
  });

  it("de-duplicates by issue id and keeps plain messages when the title adds nothing", () => {
    const issue = makeIssue({ id: "dup", title: "same", message: "same", recommendation: "" });
    const map = mapIssuesToDiagnostics(makeReport({ issues: [issue, issue] }), ROOT, path.posix);
    const list = map.get("/work/project/src/app.ts") ?? [];
    expect(list).toHaveLength(1);
    expect(list[0]?.message).toBe("same");
  });

  it("returns an empty map for an empty report", () => {
    expect(mapIssuesToDiagnostics({ issues: [] }, ROOT).size).toBe(0);
  });

  it("passes hostile messages through untouched (the Problems panel renders plain text)", () => {
    const map = mapIssuesToDiagnostics(makeReport({ issues: [makeIssue({ message: "<script>x</script>", title: "", recommendation: "" })] }), ROOT, path.posix);
    expect([...map.values()][0]?.[0]?.message).toBe("<script>x</script>");
  });
});

describe("collectReportedFiles", () => {
  it("collects the distinct file strings of a report", () => {
    const files = collectReportedFiles(makeReport());
    expect(files.has("src/a.ts")).toBe(true);
    expect(files.has("lib/b.ts")).toBe(true);
    expect(files.size).toBe(3);
  });
});
