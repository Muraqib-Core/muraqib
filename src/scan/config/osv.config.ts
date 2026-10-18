const DEFAULT_OSV_URL = "https://api.osv.dev/v1/query";
const DEFAULT_TIMEOUT_MS = 10000;

export interface OsvConfig {
  protocol: string;
  hostname: string;
  port: string | number;
  path: string;
  userAgent: string;
  timeout: number;
}

/**
 * Reads the OSV endpoint settings from the environment.
 * Resolved on every call (not at import time) so a malformed `OSV_API_URL` surfaces as an error of
 * the OSV query that needs it instead of crashing the whole CLI when the module is loaded.
 * @throws Error naming `OSV_API_URL` when it is not a valid URL
 */
export function getOsvConfig(): OsvConfig {
  const osvUrl = process.env.OSV_API_URL ?? DEFAULT_OSV_URL;
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(osvUrl);
  } catch {
    throw new Error(`OSV_API_URL is not a valid URL: ${osvUrl}`);
  }
  return {
    protocol: parsedUrl.protocol,
    hostname: parsedUrl.hostname,
    port: parsedUrl.port || (parsedUrl.protocol === "https:" ? 443 : 80),
    path: parsedUrl.pathname + parsedUrl.search,
    userAgent: "Muraqib-Audit-Tool/1.0",
    timeout: Number(process.env.OSV_TIMEOUT) || DEFAULT_TIMEOUT_MS,
  };
}
