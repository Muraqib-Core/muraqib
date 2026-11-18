import type { AgentIssue, AgentReport } from "../src/core/types.js";

export const XSS_PAYLOADS: readonly string[] = [
  "<script>alert(1)</script>",
  '"><img src=x onerror=alert(1)>',
  "'; document.location='http://evil.example'; '",
  "</style><script>steal()</script>",
  "javascript:alert(1)",
  "`${alert(1)}`",
];

export function makeIssue(overrides: Partial<AgentIssue> = {}): AgentIssue {
  return {
    id: "abc123def456",
    module: "security",
    code: "SEC001",
    severity: "error",
    title: "Hardcoded secret",
    message: "A secret is committed",
    file: "src/app.ts",
    line: 12,
    column: 5,
    recommendation: "Move it to an env var",
    tags: ["secrets"],
    ...overrides,
  };
}

export function makeReport(overrides: Partial<AgentReport> = {}): AgentReport {
  const issues = overrides.issues ?? [
    makeIssue({ id: "i1", severity: "critical", title: "RCE", file: "src/a.ts", line: 3 }),
    makeIssue({ id: "i2", severity: "error" }),
    makeIssue({ id: "i3", severity: "warning", module: "memory", code: "MEM1", file: undefined as unknown as string }),
    makeIssue({ id: "i4", severity: "info", module: "memory", code: "MEM2", file: "lib/b.ts", line: 9 }),
  ];
  return {
    schemaVersion: "1.0",
    ok: true,
    verdict: "fail",
    exitCode: 1,
    projectRoot: "/work/project",
    summary: { total: issues.length, critical: 1, error: 1, warning: 1, info: 1 },
    modules: [
      { name: "memory", status: "warning", issueCount: 2 },
      {
        name: "scan",
        status: "issues",
        issueCount: 0,
        scan: {
          mode: "build",
          exitCode: 0,
          hasBlockingIssues: false,
          scannerCoverage: [
            {
              scanner: "osv",
              status: "partial",
              scannedInputs: ["package-lock.json"],
              skippedInputs: ["yarn.lock"],
              diagnostics: ["registry unreachable"],
            },
          ],
        },
      } as AgentReport["modules"][number],
      { name: "security", status: "issues", issueCount: 2 },
    ],
    issues,
    truncated: 0,
    ...overrides,
  };
}

export const NONCE = "dGVzdG5vbmNlMTIzNDU2";
