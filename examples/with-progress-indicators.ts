/**
 * Example: Running Muraqib audits with progress indicators and metrics collection
 *
 * This example demonstrates:
 * - Using progress indicators for visual feedback
 * - Collecting and displaying performance metrics
 * - Handling audit results
 */

import { performConfigAudit } from "../src/core/config-guard.js";
import { performMemoryAudit } from "../src/core/memory-guard.js";
import { createProgress, MetricsCollector } from "../src/shared/progress.js";

async function auditProjectWithMetrics(projectPath: string) {
  console.log("🚀 Starting Muraqib audit with progress indicators...\n");

  const metrics = new MetricsCollector(false); // false = show output
  const startTotal = Date.now();

  // ─────────────────────────────────────────────────────────────────────────
  // 1. Config Audit
  // ─────────────────────────────────────────────────────────────────────────
  const configProgress = createProgress("🔧 Config & Security Audit", false);
  configProgress.start();

  const configStart = Date.now();
  const configResult = performConfigAudit(projectPath);
  const configDuration = Date.now() - configStart;

  if (configResult.isValid) {
    configProgress.succeed("✓ Configuration is secure", configResult.reports.length);
  } else {
    configProgress.fail("Configuration issues found");
    console.log("\nFound issues:");
    configResult.reports.forEach((report: string) => {
      console.log(`  ⚠️  ${report}`);
    });
  }

  metrics.record(
    "Config Audit",
    configDuration,
    3, // number of config files checked
    configResult.insecureConfigs.length
  );

  // ─────────────────────────────────────────────────────────────────────────
  // 2. Memory Audit
  // ─────────────────────────────────────────────────────────────────────────
  const memProgress = createProgress("💾 Memory & Heap Audit", false);
  memProgress.start();

  const memStart = Date.now();
  const memResult = performMemoryAudit();
  const memDuration = Date.now() - memStart;

  if (memResult.isOptimized) {
    memProgress.succeed("✓ Memory usage is optimal");
  } else {
    memProgress.fail("Memory optimization issues found");
    console.log("\nFound issues:");
    memResult.reports.forEach((report: string) => {
      console.log(`  ⚠️  ${report}`);
    });
  }

  metrics.record("Memory Audit", memDuration, 1, memResult.reports.length);

  // ─────────────────────────────────────────────────────────────────────────
  // 3. Print Summary
  // ─────────────────────────────────────────────────────────────────────────
  const totalDuration = Date.now() - startTotal;

  console.log("\n" + "─".repeat(60));
  console.log("📊 AUDIT SUMMARY");
  console.log("─".repeat(60));

  // Show results
  console.log("\nResults:");
  console.log(`  Config Audit:  ${configResult.isValid ? "✅ PASS" : "❌ FAIL"}`);
  console.log(`  Memory Audit:  ${memResult.isOptimized ? "✅ PASS" : "❌ FAIL"}`);

  // Show metrics
  metrics.printSummary();

  // Overall status
  const allPassed = configResult.isValid && memResult.isOptimized;
  console.log(`\n${allPassed ? "✅" : "⚠️"} Overall: ${allPassed ? "HEALTHY" : "NEEDS ATTENTION"}`);
  console.log(`⏱️  Total time: ${(totalDuration / 1000).toFixed(2)}s\n`);

  return {
    success: allPassed,
    results: { config: configResult, memory: memResult },
    metrics: metrics.getMetrics(),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Example with error handling
// ─────────────────────────────────────────────────────────────────────────
async function main() {
  try {
    // Use current directory or pass custom path
    const projectPath = process.argv[2] || "./";

    const auditResults = await auditProjectWithMetrics(projectPath);

    if (!auditResults.success) {
      console.log("⚠️  Some audits require attention. Review the issues above.\n");
      process.exit(1);
    }

    console.log("✅ All audits passed! Your project is healthy.\n");
    process.exit(0);
  } catch (error) {
    console.error("❌ Audit failed with error:", error);
    process.exit(1);
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}

export { auditProjectWithMetrics };
