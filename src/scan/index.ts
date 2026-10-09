/**
 * Scan layer (ported verbatim from Jenan's pre-muraqib `develop` branch).
 *
 * Contract-driven engines that produce deterministic `Finding`s:
 * OSV scanner, Docker (Dockerfile/compose/image/runtime) scanner, compatibility engine,
 * env validation engines, resolution engine/plan/applier and the audit runner.
 */
export * from "./core/contracts/scanner-engine.js";
export * from "./core/contracts/validation-engine.js";
export type { ValidationEngineResolver } from "./core/contracts/engine-resolver.js";
export * from "./core/findings/finding.js";
export { FindingCollector as ScanFindingCollector } from "./core/findings/finding-collector.js";
export * from "./core/context/project-context.js";
export * from "./core/context/docker-discovery.js";
export * from "./core/parsers/env-parser.js";
export * from "./core/resolution/dependency-graph.js";
export * from "./core/resolution/resolution-engine.js";
export * from "./core/resolution/resolution-plan.js";
export * from "./core/resolution/resolution-applier.js";
export * from "./core/runner/audit-runner.js";
export * from "./scanners/dependency/osv-engine.js";
export * from "./scanners/dependency/osv-client.js";
export * from "./scanners/compatibility/compatibility-engine.js";
export * from "./scanners/docker/docker-engine.js";
export * from "./scanners/docker/image-engine.js";
export * from "./scanners/docker/runtime-engine.js";
