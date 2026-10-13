/**
 * Runs the guard orchestrator (plus the optional scan layer) and returns typed results.
 * Shared by the CLI report builder and the agent API so neither re-implements module selection.
 */
import { AuditOrchestrator } from "../core/orchestrator.js";
import { buildAuditContext } from "../core/audit-context.js";
import { runScanAudit } from "../scan/bridge.js";
import type { AuditResult } from "../core/types.js";
import type { ValidationEngineName } from "../scan/guard/core/engine-detector.js";

export interface CollectOptions {
  projectRoot: string;
  /** Substring filters on module names (case-insensitive). */
  modules?: string[] | undefined;
  securityUrl?: string | undefined;
  /** Include the scan layer (OSV, Docker, compatibility, env files). */
  scan?: boolean | undefined;
  aiAdvisory?: boolean | undefined;
  dockerNative?: boolean | undefined;
  /** Blocking policy mode for the scan layer (defaults to build). */
  mode?: "build" | "prod" | undefined;
  /** Preferred env-validation engine for the scan layer. */
  engine?: ValidationEngineName | undefined;
}

export interface CollectedResults {
  results: AuditResult[];
  /** AI advisory text, only when the scan layer ran with AI enabled. */
  aiAdvisory: string | null;
}

/**
 * Collect audit results.
 *
 * @param options - Options
 * @returns Collect audit results result
 */
export async function collectAuditResults(options: CollectOptions): Promise<CollectedResults> {
  const root = options.projectRoot;
  const orchestrator = new AuditOrchestrator(buildAuditContext(root), {
    projectRoot: root,
    asyncTargetPath: root,
    configProjectRoot: root,
    dependencyTargetPath: root,
    dockerProjectRoot: root,
    imageTargetPath: root,
    deadCodeTargetPath: root,
    securityTargetUrl: options.securityUrl,
  });

  const unified = await orchestrator.execute();
  const wanted = options.modules?.map((m) => m.trim().toLowerCase()).filter(Boolean) ?? [];
  const results = wanted.length
    ? unified.results.filter((r) => wanted.some((w) => r.module.toLowerCase().includes(w)))
    : [...unified.results];

  let aiAdvisory: string | null = null;
  if (options.scan) {
    const outcome = await runScanAudit(root, {
      enableAi: options.aiAdvisory ?? false,
      dockerNative: options.dockerNative ?? false,
      ...(options.mode ? { mode: options.mode } : {}),
      ...(options.engine ? { engine: options.engine } : {}),
    });
    results.push(outcome.result);
    aiAdvisory = outcome.report.aiAdvisory;
  }
  return { results, aiAdvisory };
}
