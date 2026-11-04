/**
 * Programmatic audit report creation used by the CLI and the public API.
 */
import type { CliOptions, AuditReport } from "./types.js";
import { auditExitCode } from "../core/audit-exit-code.js";
import { collectAuditResults } from "../orchestrator/collect-results.js";
import type { ValidationEngineName } from "../scan/guard/core/engine-detector.js";

/**
 * Create audit report.
 *
 * @param options - Options
 * @returns Create audit report result
 */
export async function createAuditReport(
  options: CliOptions & {
    securityUrl?: string | undefined;
    scan?: boolean;
    aiAdvisory?: boolean;
    dockerNative?: boolean;
    env?: "build" | "prod" | undefined;
    engine?: ValidationEngineName | undefined;
  }
): Promise<AuditReport> {
  const root = options.projectRoot;
  const { results: scanned, aiAdvisory: aiText } = await collectAuditResults({
    projectRoot: root,
    modules: options.modules,
    securityUrl: options.securityUrl,
    scan: options.scan,
    aiAdvisory: options.aiAdvisory,
    dockerNative: options.dockerNative,
    mode: options.env,
    engine: options.engine,
  });

  const issues = scanned.flatMap((r) => r.issues);
  const count = (sev: string) => issues.filter((i) => i.severity === sev).length;

  const modules: Record<string, unknown> = {};
  for (const r of scanned) modules[r.module] = r;
  if (aiText) modules["ai-advisory"] = { advisory: aiText };

  return {
    timestamp: Date.now(),
    projectRoot: root,
    exitCode: auditExitCode(scanned, options.failOnWarning),
    summary: {
      total: issues.length,
      critical: count("critical"),
      error: count("error"),
      warning: count("warning"),
      info: count("info"),
    },
    modules,
  };
}
