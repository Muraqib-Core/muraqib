export interface PerformanceAuditResult {
  isOptimized: boolean;
  reports: string[];
  cacheMaxAge?: number;
  compressionEnabled?: boolean;
}

const MIN_CACHE_MAX_AGE_SECONDS = 86400;

/**
 * Checks the cache/compression settings in the given environment.
 * Never exits the process and never assumes a pass: every problem
 * (including a missing variable) is returned as a report.
 */
export const runPerformanceAudit = (
  env: Record<string, string | undefined> = process.env
): PerformanceAuditResult => {
  const reports: string[] = [];
  const result: PerformanceAuditResult = { isOptimized: false, reports };

  const rawMaxAge = env.STATIC_ASSETS_CACHE_MAX_AGE?.trim();
  if (!rawMaxAge) {
    reports.push("STATIC_ASSETS_CACHE_MAX_AGE is not set — static asset caching cannot be verified.");
  } else {
    const maxAge = Number(rawMaxAge);
    if (!Number.isFinite(maxAge)) {
      reports.push(`STATIC_ASSETS_CACHE_MAX_AGE is not a number: "${rawMaxAge}".`);
    } else {
      result.cacheMaxAge = maxAge;
      if (maxAge < MIN_CACHE_MAX_AGE_SECONDS) {
        reports.push(
          `Cache max-age is ${maxAge}s — it must be at least 1 day (${MIN_CACHE_MAX_AGE_SECONDS}s).`
        );
      }
    }
  }

  const rawCompression = env.ENABLE_SERVER_COMPRESSION?.trim();
  if (!rawCompression) {
    reports.push("ENABLE_SERVER_COMPRESSION is not set — Gzip/Brotli compression cannot be verified.");
  } else {
    result.compressionEnabled = rawCompression.toLowerCase() === "true";
    if (!result.compressionEnabled) {
      reports.push("Gzip/Brotli compression is disabled (ENABLE_SERVER_COMPRESSION is not \"true\").");
    }
  }

  result.isOptimized = reports.length === 0;
  return result;
};
