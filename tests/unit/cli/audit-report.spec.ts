import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createAuditReport, runCli } from "../../../src/cli/index.js";
import { buildAuditContext } from "../../../src/core/audit-context.js";
import { runAudit } from "../../../src/index.js";

function tmpProject() {
  const dir = mkdtempSync(join(tmpdir(), "muraqib-cli-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "x", version: "1.0.0" }));
  return dir;
}

describe("CLI wiring", () => {
  it("buildAuditContext fills runtime metadata", () => {
    const ctx = buildAuditContext(tmpProject());
    expect(ctx.nodeVersion).toBe(process.version);
    expect(["development", "production", "ci"]).toContain(ctx.environment);
  });

  it("createAuditReport runs real guards", async () => {
    const report = await createAuditReport({
      projectRoot: tmpProject(),
      format: "json",
      verbose: false,
      failOnWarning: false,
    });
    expect(Object.keys(report.modules)).toContain("memory-guard");
    expect(report.summary.total).toBeGreaterThanOrEqual(0);
  });

  it("module filter limits the report", async () => {
    const report = await createAuditReport({
      projectRoot: tmpProject(),
      format: "json",
      verbose: false,
      failOnWarning: false,
      modules: ["memory"],
    });
    expect(Object.keys(report.modules)).toEqual(["memory-guard"]);
  });

  it("runAudit returns a unified result", async () => {
    const result = await runAudit({ projectRoot: tmpProject() });
    expect(result.success).toBe(true);
    expect(result.results.length).toBeGreaterThan(0);
  });

  it("runCli returns an exit code", async () => {
    const out = join(tmpProject(), "r.json");
    const code = await runCli(["audit", "-p", tmpProject(), "-f", "json", "-m", "memory", "-o", out]);
    expect(code).toBe(0);
  });
});
