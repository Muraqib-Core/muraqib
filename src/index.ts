/**
 * Muraqib Core - Main Entry Point
 * AI-complementary DevTool (Aya + Jenan)
 */

export * from "./core/types.js";
export { BaseGuard } from "./core/base-guard.js";

// Core Guards
export * from "./core/memory-guard.js";
export * from "./core/security-guard.js";
export * from "./core/dependency-guard.js";
export * from "./core/async-guard.js";
export * from "./core/docker-guard.js";
export * from "./core/compatibility-guard.js";

// Performance Modules
export * from "./core/performance/auditor.js";
export * from "./core/performance/image-guard.js";
export * from "./core/performance/network-latency-advisor.js";
export * from "./core/performance/optimizer-engine.js";

// Rules
export * from "./rules/bundle-budget.js";
export * from "./rules/cache-guard.js";
export * from "./rules/dead-code-guard.js";

// AI Integration
export * from "./ai/secret-detector.js";
export * from "./ai/advisor.js";

export async function runAudit() {
  return { success: true, message: "Muraqib Core initialized" };
}
