import { toMessage } from "../shared/utils.js";
import { setSilentMode } from "../shared/logger.js";
import {
  type AuditOptions,
  type AuditResult,
  createInitialAuditResult,
  runImageAudit,
  runBundleAudit,
  runNetworkAudit,
  runMemoryAudit,
  runSecurityAudit,
  runDeadCodeAudit,
  runDependencyAudit,
  runAsyncAudit,
  runConfigAudit,
  runEnvAudit,
  runPerformanceAudit,
  runOptimizerAudit,
  runRenderBlockingAudit,
  runUpgradePackages,
} from "../orchestrator/audit.js";
import { log, section, renderHeader, renderSummary, Colors, setSilent } from "../renderers/index.js";

const { RED, GREEN, YELLOW, DIM, RESET } = Colors;

export async function runAuditWorkflow(options: AuditOptions = {}): Promise<AuditResult> {
  const targetPath = options.targetPath || process.cwd();
  const latencyUrl = options.latencyUrl || "http://localhost:3000";
  const securityUrl = options.securityUrl || latencyUrl;
  const silent = options.silent || false;

  setSilent(silent);
  setSilentMode(silent);
  renderHeader(targetPath);

  const result = createInitialAuditResult();

  // Mark skipped checks
  const skipMap: [keyof AuditResult, boolean | undefined][] = [
    ["env", options.skipEnv],
    ["network", options.skipNetwork],
    ["memory", options.skipMemory],
    ["security", options.skipSecurity],
    ["deadCode", options.skipDeadCode],
    ["dependencies", options.skipDependencies],
    ["async", options.skipAsync],
    ["config", options.skipConfig],
    ["performance", options.skipPerformance],
    ["optimizer", options.skipOptimizer || options.skipNetwork],
    ["renderBlocking", options.skipRenderBlocking],
  ];

  for (const [key, skip] of skipMap) {
    if (skip) result[key].skipped = true;
  }
  if (options.skipSecurity) delete result.security.score;

  // 1. Images
  section("1️⃣  STATIC ASSETS (Images)");
  {
    const audit = await runImageAudit(targetPath);
    result.images = audit;
    if (audit.ok) {
      log("Image audit", "pass", "All images within 500 KB limit");
    } else {
      log("Image audit", "fail", `${audit.errors.length} oversized image(s)`);
      for (const err of audit.errors) {
        console.log(`    ${RED}•${RESET} ${err}`);
      }
    }
  }

  // 2. Bundle
  section("2️⃣  BUNDLE SIZE");
  {
    const audit = await runBundleAudit(targetPath);
    result.bundle = audit;
    if (audit.skipped) {
      log("Bundle audit", "warn", "No source files found — nothing was measured");
    } else if (audit.ok) {
      log("Bundle audit", "pass", "File(s) within 14 KB round-trip budget");
    } else {
      log("Bundle audit", "fail", `${audit.errors.length} issue(s)`);
      for (const err of audit.errors) {
        console.log(`    ${RED}•${RESET} ${err}`);
      }
    }
  }

  // 3. Network
  if (!options.skipNetwork) {
    section("3️⃣  NETWORK LATENCY");
    const audit = await runNetworkAudit(latencyUrl);
    result.network = audit;
    if (audit.ok) {
      log("Latency check", "pass", "Request optimized");
    } else {
      log("Latency check", "fail", `${audit.errors.length} issue(s)`);
      for (const err of audit.errors) {
        console.log(`    ${YELLOW}•${RESET} ${err}`);
      }
    }
  }

  // 4. Memory
  if (!options.skipMemory) {
    section("4️⃣  MEMORY USAGE");
    const audit = await runMemoryAudit();
    result.memory = audit;
    if (audit.ok) {
      log("Memory audit", "pass", "Memory usage optimal");
    } else {
      log("Memory audit", "warn", `${audit.errors.length} issue(s)`);
      for (const err of audit.errors) {
        console.log(`    ${YELLOW}•${RESET} ${err}`);
      }
    }
  }

  // 5. Security
  if (!options.skipSecurity) {
    section("5️⃣  SECURITY HEADERS");
    const audit = await runSecurityAudit(securityUrl);
    result.security = audit;
    const score = audit.score || 0;
    if (audit.ok) {
      log("Security audit", "pass", `Score: ${score}/100`);
    } else {
      log("Security audit", score < 50 ? "fail" : "warn", `Score: ${score}/100 — ${audit.errors.length} issue(s)`);
      for (const err of audit.errors) {
        console.log(`    ${score < 50 ? RED : YELLOW}•${RESET} ${err}`);
      }
    }
  }

  // 6. Dead Code
  if (!options.skipDeadCode) {
    section("6️⃣  DEAD CODE DETECTION");
    const audit = await runDeadCodeAudit(targetPath);
    result.deadCode = audit;
    if (audit.ok) {
      log("Dead code audit", "pass", "No dead code detected");
    } else {
      log("Dead code audit", "warn", `${audit.errors.length} issue(s)`);
      for (const err of audit.errors) {
        console.log(`    ${YELLOW}•${RESET} ${err}`);
      }
    }
  }

  // 7. Dependencies
  if (!options.skipDependencies) {
    section("7️⃣  DEPENDENCY ANALYSIS");
    const audit = await runDependencyAudit(targetPath);
    result.dependencies = audit;
    if (audit.ok) {
      log("Dependency audit", "pass", "No issues found");
    } else {
      log("Dependency audit", "warn", `${audit.errors.length} issue(s)`);
      for (const err of audit.errors) {
        console.log(`    ${YELLOW}•${RESET} ${err}`);
      }
    }
  }

  // 8. Async
  if (!options.skipAsync) {
    section("8️⃣  ASYNC PATTERNS");
    const audit = await runAsyncAudit(targetPath);
    result.async = audit;
    if (audit.ok) {
      log("Async audit", "pass", "No async issues detected");
    } else {
      log("Async audit", "warn", `${audit.errors.length} issue(s)`);
      for (const err of audit.errors) {
        console.log(`    ${YELLOW}•${RESET} ${err}`);
      }
    }
  }

  // 9. Config
  if (!options.skipConfig) {
    section("9️⃣  CONFIGURATION VALIDATION");
    const audit = await runConfigAudit(targetPath);
    result.config = audit;
    if (audit.ok) {
      log("Config audit", "pass", "All configurations valid");
    } else {
      log("Config audit", "warn", `${audit.errors.length} issue(s)`);
      for (const err of audit.errors) {
        console.log(`    ${YELLOW}•${RESET} ${err}`);
      }
    }
  }

  // 10. Env
  if (!options.skipEnv) {
    section("🔟 ENVIRONMENT VARIABLES");
    const audit = await runEnvAudit(targetPath, {
      ...(options.presets ? { presets: options.presets } : {}),
      ...(options.schedule ? { schedule: options.schedule } : {}),
      ...(options.safe ? { safe: options.safe } : {}),
    });
    result.env = audit;
    if (audit.ok) {
      log("Env validation", "pass", "All variables valid");
    } else {
      log("Env validation", "fail", `${audit.errors.length} violation(s)`);
      for (const err of audit.errors) {
        console.log(`    ${RED}•${RESET} ${err}`);
      }
    }
  }

  // 11. Performance
  if (!options.skipPerformance) {
    section("1️⃣1️⃣  PERFORMANCE CACHE");
    const audit = await runPerformanceAudit();
    result.performance = audit;
    if (audit.ok) {
      log("Performance audit", "pass", "Cache performance optimal");
    } else {
      log("Performance audit", "warn", `${audit.errors.length} issue(s)`);
      for (const err of audit.errors) {
        console.log(`    ${YELLOW}•${RESET} ${err}`);
      }
    }
  }

  // 12. Optimizer
  if (!options.skipOptimizer && !options.skipNetwork) {
    section("1️⃣2️⃣  HTTP OPTIMIZER");
    const audit = await runOptimizerAudit(targetPath, latencyUrl);
    result.optimizer = audit;
    if (audit.ok) {
      log("Optimizer audit", "pass", "HTTP/cookie settings optimal");
    } else {
      log("Optimizer audit", "warn", `${audit.errors.length} issue(s)`);
      for (const err of audit.errors) {
        console.log(`    ${YELLOW}•${RESET} ${err}`);
      }
    }
  }

  // 13. Render Blocking
  if (!options.skipRenderBlocking) {
    section("1️⃣3️⃣  RENDER BLOCKING");
    const audit = await runRenderBlockingAudit(targetPath);
    result.renderBlocking = audit;
    if (audit.ok) {
      log("Render blocking audit", "pass", "No render blocking scripts");
    } else {
      log("Render blocking audit", "warn", `${audit.errors.length} issue(s)`);
      for (const err of audit.errors) {
        console.log(`    ${YELLOW}•${RESET} ${err}`);
      }
    }
  }

  // Upgrade packages
  if (options.upgrade) {
    section("🔄  PACKAGE UPGRADE");
    try {
      await runUpgradePackages(targetPath);
      log("Package upgrade", "pass", "Packages upgraded with rollback support");
    } catch (err: unknown) {
      log("Package upgrade", "fail", toMessage(err));
    }
  }

  // Summary
  section("📋 FINAL SUMMARY");
  const allOk =
    result.env.ok &&
    result.images.ok &&
    result.bundle.ok &&
    result.network.ok &&
    result.memory.ok &&
    result.security.ok &&
    result.deadCode.ok &&
    result.dependencies.ok &&
    result.async.ok &&
    result.config.ok &&
    result.performance.ok &&
    result.optimizer.ok &&
    result.renderBlocking.ok;

  const rows: [string, AuditResult[keyof AuditResult], "FAIL" | "WARN"][] = [
    ["Environment", result.env, "FAIL"],
    ["Images", result.images, "FAIL"],
    ["Bundle", result.bundle, "FAIL"],
    ["Network", result.network, "FAIL"],
    ["Memory", result.memory, "WARN"],
    ["Security", result.security, "FAIL"],
    ["Dead Code", result.deadCode, "WARN"],
    ["Dependencies", result.dependencies, "WARN"],
    ["Async", result.async, "WARN"],
    ["Config", result.config, "FAIL"],
    ["Performance", result.performance, "WARN"],
    ["Optimizer", result.optimizer, "WARN"],
    ["Render Block", result.renderBlocking, "WARN"],
  ];

  for (const [name, mod, failLabel] of rows) {
    const failColor = failLabel === "FAIL" ? RED : YELLOW;
    const status = mod.skipped
      ? `${DIM}SKIP${RESET}`
      : mod.ok
        ? `${GREEN}PASS${RESET}`
        : `${failColor}${failLabel}${RESET}`;
    const count = mod.errors.length;
    const detail = mod.skipped ? `${DIM}not run${RESET}` : count > 0 ? `${failColor}${count} issue(s)${RESET}` : `${GREEN}clean${RESET}`;
    console.log(`  ${name.padEnd(15)} ${status.padEnd(12)} ${detail}`);
  }

  const skippedCount = rows.filter(([, mod]) => mod.skipped).length;

  console.log("");
  const criticalCount =
    result.images.errors.length +
    result.bundle.errors.length +
    result.network.errors.length +
    result.env.errors.length +
    result.security.errors.length +
    result.config.errors.length;
  const warningCount =
    result.memory.errors.length +
    result.deadCode.errors.length +
    result.dependencies.errors.length +
    result.async.errors.length +
    result.performance.errors.length +
    result.optimizer.errors.length +
    result.renderBlocking.errors.length;

  renderSummary(allOk, skippedCount, criticalCount, warningCount);
  console.log("");

  const failed =
    !result.env.ok ||
    !result.images.ok ||
    !result.bundle.ok ||
    !result.network.ok ||
    !result.memory.ok ||
    !result.security.ok ||
    !result.deadCode.ok ||
    !result.async.ok ||
    !result.config.ok ||
    !result.renderBlocking.ok;

  // Note: Only exit if called from CLI directly (when run() is invoked)
  // When used as an API, this should just return results
  if (options.exitProcess) {
    process.exit(failed ? 1 : 0);
  }

  return result;
}
