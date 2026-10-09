/**
 * CI audit collector — runs the audit without a live server and writes
 * the result to audit-report.json. Always exits 0 so the CI step
 * "Upload audit artifact" always runs (the artifact stores findings
 * for review; blocking CI is opt-in via a separate policy step).
 */
import fs from "node:fs";
import path from "node:path";
import { loadEnv } from "../src/env.js";
import { runAudit } from "../src/index.js";

async function main() {
  const reportDir = process.cwd();
  const reportPath = path.join(reportDir, "audit-report.json");

  // Load environment variables from .env file
  try {
    loadEnv({ cwd: reportDir, verbose: false });
  } catch (e) {
    console.warn("Warning: Could not load .env file:", e instanceof Error ? e.message : String(e));
  }

  let result: Awaited<ReturnType<typeof runAudit>>;
  let auditError: string | null = null;

  try {
    result = await runAudit({
      targetPath: reportDir,
      skipNetwork: true,
      skipSecurity: true,
      skipMemory: true,
      skipPerformance: true,
      silent: true,
    });
  } catch (error: unknown) {
    auditError = error instanceof Error ? error.message : String(error);
    const notRun = () => ({ ok: false, errors: [`Audit did not run: ${auditError}`] });
    result = {
      env: notRun(),
      images: notRun(),
      bundle: notRun(),
      network: notRun(),
      memory: notRun(),
      security: { ...notRun(), score: 0 },
      deadCode: notRun(),
      dependencies: notRun(),
      async: notRun(),
      config: notRun(),
      performance: notRun(),
      optimizer: notRun(),
      renderBlocking: notRun(),
    };
  }

  console.error("[DEBUG] About to create payload...");
  const payload = {
    generatedAt: new Date().toISOString(),
    ...(auditError ? { auditError } : {}),
    result,
  };
  console.error("[DEBUG] Payload created, about to write...");

  // Write report file
  try {
    console.error("[DEBUG] Inside try block, creating JSON payload...");
    const reportJson = JSON.stringify(payload, null, 2);
    console.error("[DEBUG] JSON created, writing to file...");
    fs.writeFileSync(reportPath, reportJson, "utf-8");
    console.error("[DEBUG] File written successfully");
    console.log(`✓ Report saved to ${reportPath}`);
  } catch (writeErr: unknown) {
    const errMsg = writeErr instanceof Error ? writeErr.message : String(writeErr);
    console.error(`✗ Failed to write report: ${errMsg}`);
    console.error(`  Path: ${reportPath}`);
    console.error(`  Dir exists: ${fs.existsSync(reportDir)}`);
    console.error(`  Error object:`, writeErr);
    process.exit(1);
  }

  // Print summary
  const anyFailed = Object.values(result).some(
    (v) => typeof v === "object" && v !== null && "ok" in v && !v.ok
  );

  console.log("---");
  if (auditError) {
    console.error(`Audit error: ${auditError}`);
  } else if (anyFailed) {
    console.log("✓ Audit completed with failures");
  } else {
    console.log("✓ Audit passed!");
  }

  // Ensure exit code is 0 so CI artifact upload runs
  setTimeout(() => process.exit(0), 100);
}

main().catch((err) => {
  console.error("\n❌ FATAL ERROR in audit script:");
  console.error(err instanceof Error ? err.message : String(err));
  if (err instanceof Error && err.stack) {
    console.error("\nStack trace:");
    console.error(err.stack);
  }
  process.exit(1);
});
