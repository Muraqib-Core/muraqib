import type { AgentAuditOptions } from "./types.js";
import { isSafeUrl } from "./escape.js";

/** Read access to the `muraqib.*` configuration section; the adapter wraps `WorkspaceConfiguration`. */
export interface SettingsReader {
  get(key: string): unknown;
}

const DEFAULT_MAX_ISSUES = 500;

function bool(value: unknown): boolean {
  return value === true;
}

/**
 * Turn user settings into engine options. Settings files can hold anything, so each value is
 * type-checked and invalid ones fall back to the default. `aiAdvisory` is intentionally not
 * exposed: it would send project data to an external service.
 */
export function toAuditOptions(settings: SettingsReader, projectRoot: string): AgentAuditOptions {
  const rawModules = settings.get("modules");
  const modules = Array.isArray(rawModules)
    ? rawModules.filter((m): m is string => typeof m === "string" && m.trim() !== "").map((m) => m.trim())
    : [];
  const rawUrl = settings.get("securityUrl");
  const securityUrl = typeof rawUrl === "string" && isSafeUrl(rawUrl.trim()) ? rawUrl.trim() : undefined;
  const rawMax = settings.get("maxIssues");
  const maxIssues =
    typeof rawMax === "number" && Number.isInteger(rawMax) && rawMax >= 0 ? rawMax : DEFAULT_MAX_ISSUES;

  return {
    projectRoot,
    modules: modules.length > 0 ? modules : undefined,
    securityUrl,
    osv: bool(settings.get("osv")),
    docker: bool(settings.get("docker")),
    failOnWarning: bool(settings.get("failOnWarning")),
    // 0 means "no limit" in the setting, but the engine reads 0 as "return nothing".
    maxIssues: maxIssues === 0 ? undefined : maxIssues,
  };
}
