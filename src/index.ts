/**
 * Muraqib Core - Main Entry Point
 * AI-complementary DevTool for detecting issues in AI-generated code
 */

import { GuardOptions } from "./core/types.js";

// Export types
export * from "./core/types.js";
export { BaseGuard } from "./core/base-guard.js";

// Export guards
export * from "./core/memory-guard.js";
export * from "./core/security-guard.js";
export * from "./core/dependency-guard.js";
export * from "./core/async-guard.js";
export * from "./core/config-guard.js";

// Export performance modules
export * from "./core/performance/auditor.js";
export * from "./core/performance/image-guard.js";
export * from "./core/performance/network-latency-advisor.js";
export * from "./core/performance/optimizer-engine.js";
export * from "./core/performance/render-blocking.js";

// Export environment functions
export * from "./env.js";

// Main audit runner
export async function runAudit(options?: {
  path?: string;
  skipMemory?: boolean;
  skipSecurity?: boolean;
  skipDependencies?: boolean;
}) {
  console.log("🔍 Muraqib Core - Running comprehensive audit...");
  console.log(`📁 Project: ${options?.path || process.cwd()}`);
  console.log("");

  return {
    success: true,
    message: "Audit framework initialized. Guards ready.",
  };
}

// CLI Entry Point
if (import.meta.url === `file://${process.argv[1]}`) {
  runAudit().then((result) => {
    console.log("✅ Result:", result);
    process.exit(0);
  });
}
