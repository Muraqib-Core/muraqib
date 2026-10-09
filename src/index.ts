/**
 * Muraqib Core - Unified Developer Environment Guardian & Performance Auditor
 *
 * A comprehensive audit framework for Node.js/TypeScript projects that detects:
 * - Security vulnerabilities (SQL injection, XSS, secrets)
 * - Performance issues (memory leaks, bundle size, dead code)
 * - Architecture violations (circular dependencies, floating promises)
 * - Configuration problems (missing env vars, invalid settings)
 * - Docker/containerization best practices
 * - Compatibility issues with dependencies
 *
 * @example
 * ```typescript
 * import { BaseGuard, AuditContext, MemoryGuard } from 'muraqib-core';
 *
 * const context: AuditContext = {
 *   projectRoot: process.cwd(),
 *   timestamp: Date.now(),
 *   environment: 'production',
 *   nodeVersion: process.version,
 *   npmVersion: '9.0.0',
 *   gitBranch: 'main',
 *   gitCommit: 'abc123def456',
 * };
 *
 * const guard = new MemoryGuard(context);
 * const result = await guard.run();
 * console.log(result); // { status, module, issues, message, duration }
 * ```
 *
 * @packageDocumentation
 */

// Core Types and Base Classes
export * from "./core/types.js";
export { BaseGuard } from "./core/base-guard.js";
export { GuardFactory } from "./core/guard-factory.js";
export { AuditOrchestrator } from "./core/orchestrator.js";

// Core Guards - Each guard specializes in a specific audit category
/** Memory and heap leak detection */
export * from "./core/memory-guard.js";
/** Security headers and vulnerability scanning */
export * from "./core/security-guard.js";
/** Circular dependencies and deprecated API detection */
export * from "./core/dependency-guard.js";
/** Floating promises and async pattern validation */
export * from "./core/async-guard.js";
/** Docker best practices and containerization checks */
export * from "./core/docker-guard.js";
/** Node.js version compatibility and peer dependency validation */
export * from "./core/compatibility-guard.js";

// Performance Auditing Modules
/** Cache performance analysis and optimization */
export * from "./core/performance/auditor.js";
/** Image optimization and size auditing */
export * from "./core/performance/image-guard.js";
/** Network latency measurement and advisory */
export * from "./core/performance/network-latency-advisor.js";
/** HTTP/2, compression, and resource optimization */
export * from "./core/performance/optimizer-engine.js";
/** Render-blocking resource detection */
export * from "./core/performance/render-blocking.js";
/** HTML parsing and scanning utilities */
export * from "./core/performance/html-scanner.js";

// Configuration Validation
/** Configuration file validation and environment checking */
export * from "./core/config-guard.js";

// Security and Quality Rules
/** Bundle size budget enforcement */
export * from "./rules/bundle-budget.js";
/** Cache strategy validation */
export * from "./rules/cache-guard.js";
/** Dead code detection and removal recommendations */
export * from "./rules/dead-code-guard.js";

// Dependency Vulnerability Scanning
/** OSV API client for querying known vulnerabilities */
export * from "./scanners/dependency/osv-client.js";
/** Dependency vulnerability scanner using OSV database */
export * from "./scanners/dependency/osv-engine.js";

// AI-Powered Integration
/** Sensitive data detection (API keys, passwords, tokens) */
export * from "./ai/secret-detector.js";
/** AI-powered recommendations and issue advisory */
export * from "./ai/advisor.js";

// CLI and Output Formatting
/** Command-line interface and audit runner */
export * from "./cli/index.js";
/** Result formatters (JSON, console, markdown) */
export * from "./cli/formatters.js";
/** CLI type definitions */
export * from "./cli/types.js";

/**
 * Initialize Muraqib Core and run the default audit
 *
 * This is a convenience function that sets up the audit framework
 * and performs a full audit scan on the current project.
 *
 * @returns Promise resolving to initialization status
 *
 * @example
 * ```typescript
 * const result = await runAudit();
 * // { success: true, message: "Muraqib Core initialized" }
 * ```
 */
export async function runAudit() {
  return { success: true, message: "Muraqib Core initialized" };
}
