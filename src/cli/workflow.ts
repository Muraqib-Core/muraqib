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
import { nonEmpty } from "../utils/defaults.js";

const { RED, GREEN, YELLOW, DIM, RESET } = Colors;

type ModuleOutcome = AuditResult[keyof AuditResult];

/** Everything a step needs to run, resolved once from the options. */
interface StepContext {
  options: AuditOptions;
  targetPath: string;
  latencyUrl: string;
  securityUrl: string;
}

/** One numbered stage of the workflow: when it runs, what it runs and how its outcome is printed. */
interface WorkflowStep {
  key: keyof AuditResult;
  title: string;
  enabled: (options: AuditOptions) => boolean;
  run: (ctx: StepContext) => Promise<ModuleOutcome>;
  report: (audit: ModuleOutcome) => void;
}

function printBullets(errors: readonly string[], color: string): void {
  for (const err of errors) {
    console.log(`    ${color}•${RESET} ${err}`);
  }
}

/**
 * Builds a reporter that logs one pass line, or one failure line followed by a bullet per error.
 * @param failNoun - What the count in the failure line counts, e.g. `issue(s)`.
 */
function reporter(
  label: string,
  passMessage: string,
  level: "fail" | "warn",
  failNoun = "issue(s)"
): (audit: ModuleOutcome) => void {
  return (audit) => {
    if (audit.ok) {
      log(label, "pass", passMessage);
      return;
    }
    log(label, level, `${audit.errors.length} ${failNoun}`);
    printBullets(audit.errors, level === "fail" ? RED : YELLOW);
  };
}

function reportBundle(audit: ModuleOutcome): void {
  if (audit.skipped) {
    log("Bundle audit", "warn", "No source files found — nothing was measured");
    return;
  }
  reporter("Bundle audit", "File(s) within 14 KB round-trip budget", "fail")(audit);
}

function reportNetwork(audit: ModuleOutcome): void {
  if (audit.ok) {
    log("Latency check", "pass", "Request optimized");
    return;
  }
  log("Latency check", "fail", `${audit.errors.length} issue(s)`);
  printBullets(audit.errors, YELLOW);
}

function reportSecurity(audit: ModuleOutcome): void {
  const score = "score" in audit ? (audit.score ?? 0) : 0;
  if (audit.ok) {
    log("Security audit", "pass", `Score: ${score}/100`);
    return;
  }
  const severe = score < 50;
  log("Security audit", severe ? "fail" : "warn", `Score: ${score}/100 — ${audit.errors.length} issue(s)`);
  printBullets(audit.errors, severe ? RED : YELLOW);
}

const always = (): boolean => true;

/** The thirteen audit stages, in the order they run and print. */
const WORKFLOW_STEPS: readonly WorkflowStep[] = [
  {
    key: "images",
    title: "1️⃣  STATIC ASSETS (Images)",
    enabled: always,
    run: (ctx) => runImageAudit(ctx.targetPath),
    report: reporter("Image audit", "All images within 500 KB limit", "fail", "oversized image(s)"),
  },
  {
    key: "bundle",
    title: "2️⃣  BUNDLE SIZE",
    enabled: always,
    run: (ctx) => runBundleAudit(ctx.targetPath),
    report: reportBundle,
  },
  {
    key: "network",
    title: "3️⃣  NETWORK LATENCY",
    enabled: (o) => !o.skipNetwork,
    run: (ctx) => runNetworkAudit(ctx.latencyUrl),
    report: reportNetwork,
  },
  {
    key: "memory",
    title: "4️⃣  MEMORY USAGE",
    enabled: (o) => !o.skipMemory,
    run: () => runMemoryAudit(),
    report: reporter("Memory audit", "Memory usage optimal", "warn"),
  },
  {
    key: "security",
    title: "5️⃣  SECURITY HEADERS",
    enabled: (o) => !o.skipSecurity,
    run: (ctx) => runSecurityAudit(ctx.securityUrl),
    report: reportSecurity,
  },
  {
    key: "deadCode",
    title: "6️⃣  DEAD CODE DETECTION",
    enabled: (o) => !o.skipDeadCode,
    run: (ctx) => runDeadCodeAudit(ctx.targetPath),
    report: reporter("Dead code audit", "No dead code detected", "warn"),
  },
  {
    key: "dependencies",
    title: "7️⃣  DEPENDENCY ANALYSIS",
    enabled: (o) => !o.skipDependencies,
    run: (ctx) => runDependencyAudit(ctx.targetPath),
    report: reporter("Dependency audit", "No issues found", "warn"),
  },
  {
    key: "async",
    title: "8️⃣  ASYNC PATTERNS",
    enabled: (o) => !o.skipAsync,
    run: (ctx) => runAsyncAudit(ctx.targetPath),
    report: reporter("Async audit", "No async issues detected", "warn"),
  },
  {
    key: "config",
    title: "9️⃣  CONFIGURATION VALIDATION",
    enabled: (o) => !o.skipConfig,
    run: (ctx) => runConfigAudit(ctx.targetPath),
    report: reporter("Config audit", "All configurations valid", "warn"),
  },
  {
    key: "env",
    title: "🔟 ENVIRONMENT VARIABLES",
    enabled: (o) => !o.skipEnv,
    run: (ctx) =>
      runEnvAudit(ctx.targetPath, {
        ...(ctx.options.presets ? { presets: ctx.options.presets } : {}),
        ...(ctx.options.schedule ? { schedule: ctx.options.schedule } : {}),
        ...(ctx.options.safe ? { safe: ctx.options.safe } : {}),
      }),
    report: reporter("Env validation", "All variables valid", "fail", "violation(s)"),
  },
  {
    key: "performance",
    title: "1️⃣1️⃣  PERFORMANCE CACHE",
    enabled: (o) => !o.skipPerformance,
    run: () => runPerformanceAudit(),
    report: reporter("Performance audit", "Cache performance optimal", "warn"),
  },
  {
    key: "optimizer",
    title: "1️⃣2️⃣  HTTP OPTIMIZER",
    enabled: (o) => !o.skipOptimizer && !o.skipNetwork,
    run: (ctx) => runOptimizerAudit(ctx.targetPath, ctx.latencyUrl),
    report: reporter("Optimizer audit", "HTTP/cookie settings optimal", "warn"),
  },
  {
    key: "renderBlocking",
    title: "1️⃣3️⃣  RENDER BLOCKING",
    enabled: (o) => !o.skipRenderBlocking,
    run: (ctx) => runRenderBlockingAudit(ctx.targetPath),
    report: reporter("Render blocking audit", "No render blocking scripts", "warn"),
  },
];

/** Flags the modules the options turn off (the optimizer is also off when the network is). */
function markSkipped(result: AuditResult, options: AuditOptions): void {
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
}

/** Summary rows; `failLabel` FAIL marks the modules that count as critical, WARN the rest. */
const SUMMARY_ROWS: readonly { name: string; key: keyof AuditResult; failLabel: "FAIL" | "WARN" }[] = [
  { name: "Environment", key: "env", failLabel: "FAIL" },
  { name: "Images", key: "images", failLabel: "FAIL" },
  { name: "Bundle", key: "bundle", failLabel: "FAIL" },
  { name: "Network", key: "network", failLabel: "FAIL" },
  { name: "Memory", key: "memory", failLabel: "WARN" },
  { name: "Security", key: "security", failLabel: "FAIL" },
  { name: "Dead Code", key: "deadCode", failLabel: "WARN" },
  { name: "Dependencies", key: "dependencies", failLabel: "WARN" },
  { name: "Async", key: "async", failLabel: "WARN" },
  { name: "Config", key: "config", failLabel: "FAIL" },
  { name: "Performance", key: "performance", failLabel: "WARN" },
  { name: "Optimizer", key: "optimizer", failLabel: "WARN" },
  { name: "Render Block", key: "renderBlocking", failLabel: "WARN" },
];

/** Modules whose failure makes the process exit non-zero (dependencies, performance and optimizer only warn). */
const EXIT_FAILURE_KEYS: readonly (keyof AuditResult)[] = [
  "env", "images", "bundle", "network", "memory", "security", "deadCode", "async", "config", "renderBlocking",
];

function printSummaryRow(name: string, mod: ModuleOutcome, failLabel: "FAIL" | "WARN"): void {
  const failColor = failLabel === "FAIL" ? RED : YELLOW;
  const count = mod.errors.length;
  let status = `${failColor}${failLabel}${RESET}`;
  let detail = count > 0 ? `${failColor}${count} issue(s)${RESET}` : `${GREEN}clean${RESET}`;
  if (mod.skipped) {
    status = `${DIM}SKIP${RESET}`;
    detail = `${DIM}not run${RESET}`;
  } else if (mod.ok) {
    status = `${GREEN}PASS${RESET}`;
  }
  console.log(`  ${name.padEnd(15)} ${status.padEnd(12)} ${detail}`);
}

function countErrors(result: AuditResult, failLabel: "FAIL" | "WARN"): number {
  return SUMMARY_ROWS.filter((row) => row.failLabel === failLabel)
    .reduce((sum, row) => sum + result[row.key].errors.length, 0);
}

/** Prints the final table and summary banner; returns whether any exit-relevant module failed. */
function printSummary(result: AuditResult): boolean {
  section("📋 FINAL SUMMARY");
  const allOk = SUMMARY_ROWS.every((row) => result[row.key].ok);

  for (const { name, key, failLabel } of SUMMARY_ROWS) {
    printSummaryRow(name, result[key], failLabel);
  }

  const skippedCount = SUMMARY_ROWS.filter((row) => result[row.key].skipped).length;

  console.log("");
  renderSummary(allOk, skippedCount, countErrors(result, "FAIL"), countErrors(result, "WARN"));
  console.log("");

  return EXIT_FAILURE_KEYS.some((key) => !result[key].ok);
}

/**
 * Run audit workflow.
 *
 * @param options - Options
 * @returns Run audit workflow result
 */
export async function runAuditWorkflow(options: AuditOptions = {}): Promise<AuditResult> {
  const targetPath = nonEmpty(options.targetPath, process.cwd());
  const latencyUrl = nonEmpty(options.latencyUrl, "http://localhost:3000");
  const securityUrl = nonEmpty(options.securityUrl, latencyUrl);
  const silent = options.silent ?? false;

  setSilent(silent);
  setSilentMode(silent);
  renderHeader(targetPath);

  const result = createInitialAuditResult();
  markSkipped(result, options);

  const ctx: StepContext = { options, targetPath, latencyUrl, securityUrl };
  for (const step of WORKFLOW_STEPS) {
    if (!step.enabled(options)) continue;
    section(step.title);
    const audit = await step.run(ctx);
    Object.assign(result, { [step.key]: audit });
    step.report(audit);
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

  const failed = printSummary(result);

  // Note: Only exit if called from CLI directly (when run() is invoked)
  // When used as an API, this should just return results
  if (options.exitProcess) {
    process.exit(failed ? 1 : 0);
  }

  return result;
}
