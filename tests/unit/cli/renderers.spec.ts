import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  Colors,
  box,
  formatColorizedStatus,
  getDetailColor,
  log,
  renderHeader,
  renderSummary,
  section,
  setSilent,
} from "../../../src/renderers/index.js";

describe("renderers", () => {
  let out: string[] = [];

  beforeEach(() => {
    out = [];
    setSilent(false);
    vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
      out.push(a.join(" "));
    });
  });

  afterEach(() => {
    setSilent(false);
    vi.restoreAllMocks();
  });

  test("log prints a labelled line for each status", () => {
    log("T", "pass", "ok");
    log("T", "fail");
    log("T", "warn", "careful");
    expect(out[0]).toContain("[PASS]");
    expect(out[0]).toContain("T: ok");
    expect(out[1]).toContain("[FAIL]");
    expect(out[1]).not.toContain(":");
    expect(out[2]).toContain("[WARN]");
  });

  test("section, box and header print content", () => {
    section("Name");
    box(["a", "bb"]);
    renderHeader("/target");
    const text = out.join("\n");
    expect(text).toContain("Name");
    expect(text).toContain("bb");
    expect(text).toContain("Target: /target");
  });

  test("silent mode suppresses log, section, box and header", () => {
    setSilent(true);
    log("T", "pass");
    section("S");
    box(["x"]);
    renderHeader("/p");
    expect(out).toEqual([]);
  });

  test("renderSummary covers passed, passed-with-skips and failed", () => {
    renderSummary(true, 0, 0, 0);
    renderSummary(true, 2, 0, 0);
    renderSummary(false, 0, 3, 4);
    const text = out.join("\n");
    expect(text).toContain("All checks passed!");
    expect(text).toContain("2 check(s) were skipped");
    expect(text).toContain("Critical: 3 | Warnings: 4");
  });

  test("formatColorizedStatus labels every status", () => {
    expect(formatColorizedStatus("pass")).toContain("PASS");
    expect(formatColorizedStatus("fail")).toContain("FAIL");
    expect(formatColorizedStatus("warn")).toContain("WARN");
    expect(formatColorizedStatus("skip")).toContain("SKIP");
  });

  test("getDetailColor reflects skipped, clean and issue states", () => {
    expect(getDetailColor(false, true, 0).text).toBe("not run");
    expect(getDetailColor(true, false, 0).text).toBe("clean");
    expect(getDetailColor(false, false, 2)).toEqual({ color: Colors.YELLOW, text: "2 issue(s)" });
    expect(getDetailColor(false, false, 0).color).toBe(Colors.RED);
  });
});
