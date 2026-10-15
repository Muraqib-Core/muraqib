import { describe, it, expect } from "vitest";
import { auditExitCode } from "./audit-exit-code.js";
import type { AuditResult, AuditIssue } from "./types.js";

const issue = (severity: AuditIssue["severity"], code = "X"): AuditIssue => ({ code, severity, title: "t", message: "m", tags: [] });
const result = (issues: AuditIssue[], scan?: Partial<NonNullable<AuditResult["scan"]>>): AuditResult => ({
  status: "ok", module: "m", issues, message: "", timestamp: 0, duration: 0,
  ...(scan ? { scan: scan as NonNullable<AuditResult["scan"]> } : {}),
});

describe("auditExitCode", () => {
  it("0 for no results, clean results, info and (by default) warnings", () => {
    expect(auditExitCode([])).toBe(0);
    expect(auditExitCode([result([])])).toBe(0);
    expect(auditExitCode([result([issue("info"), issue("warning")])])).toBe(0);
  });
  it("1 for error or critical", () => {
    expect(auditExitCode([result([issue("error")])])).toBe(1);
    expect(auditExitCode([result([issue("critical")])])).toBe(1);
  });
  it("crashed guard (GUARD_ERROR) is blocking", () => {
    expect(auditExitCode([result([issue("error", "GUARD_ERROR")])])).toBe(1);
  });
  it("failOnWarning escalates warnings only", () => {
    expect(auditExitCode([result([issue("warning")])], true)).toBe(1);
    expect(auditExitCode([result([issue("info")])], true)).toBe(0);
  });
  it("scan flags", () => {
    expect(auditExitCode([result([], { hasBlockingIssues: true, exitCode: 0 })])).toBe(1);
    expect(auditExitCode([result([], { hasBlockingIssues: false, exitCode: 1 })])).toBe(1);
    expect(auditExitCode([result([], { hasBlockingIssues: false, exitCode: 0 })])).toBe(0);
  });
  it("3 beats blocking issues anywhere", () => {
    expect(auditExitCode([result([issue("critical")]), result([], { exitCode: 3 })])).toBe(3);
  });
});
