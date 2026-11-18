import https from "node:https";
import http from "node:http";
import { getOsvConfig, type OsvConfig } from "../../config/osv.config.js";

const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

export interface OsvVulnerabilityEvent {
  introduced?: string;
  fixed?: string;
}

export interface OsvVulnerabilityRange {
  type: string;
  events?: OsvVulnerabilityEvent[];
}

export interface OsvVulnerabilityAffected {
  package?: {
    name: string;
    ecosystem: string;
  };
  ranges?: OsvVulnerabilityRange[];
  versions?: string[];
}

export interface OsvVulnerability {
  id: string;
  summary?: string;
  details?: string;
  affected?: OsvVulnerabilityAffected[];
}

export interface OsvResponse {
  vulns?: OsvVulnerability[];
}

export type OsvQueryResult =
  | { status: "success"; data: OsvResponse }
  | { status: "timeout"; error: string }
  | { status: "unavailable"; error: string }
  | { status: "error"; error: string };

/**
 * Query osv.
 *
 * @param packageName - Package name
 * @param version - Version
 * @returns Query osv result
 */
export function queryOsv(
  packageName: string,
  version: string
): Promise<OsvQueryResult> {
  let osvConfig: OsvConfig;
  try {
    osvConfig = getOsvConfig();
  } catch (err) {
    return Promise.resolve({ status: "unavailable", error: err instanceof Error ? err.message : String(err) });
  }

  return new Promise((resolve) => {
    const postData = JSON.stringify({
      version,
      package: {
        name: packageName,
        ecosystem: "npm",
      },
    });

    const options = {
      hostname: osvConfig.hostname,
      port: osvConfig.port,
      path: osvConfig.path,
      method: "POST",
      timeout: osvConfig.timeout,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(postData),
        "User-Agent": osvConfig.userAgent,
      },
    };

    let isHandled = false;

    const requestModule = osvConfig.protocol === "http:" ? http : https;
    const req = requestModule.request(options, (res) => {
      const chunks: Buffer[] = [];
      let received = 0;

      res.on("data", (chunk: Buffer) => {
        if (isHandled) return;
        received += chunk.length;
        if (received > MAX_RESPONSE_BYTES) {
          isHandled = true;
          req.destroy();
          resolve({ status: "error", error: `OSV response for ${packageName} exceeded the 5 MiB safety limit` });
          return;
        }
        chunks.push(chunk);
      });

      res.on("end", () => {
        if (isHandled) return;
        isHandled = true;

        if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
          resolve({
            status: "unavailable",
            error: `OSV service returned HTTP status ${res.statusCode}`,
          });
          return;
        }

        try {
          const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as OsvResponse;
          resolve({ status: "success", data: parsed });
        } catch {
          resolve({
            status: "error",
            error: `Failed to parse OSV response for ${packageName}`,
          });
        }
      });
    });

    req.on("timeout", () => {
      if (isHandled) return;
      isHandled = true;
      req.destroy();
      resolve({
        status: "timeout",
        error: `OSV query timed out after ${osvConfig.timeout}ms for ${packageName}`,
      });
    });

    req.on("error", (err) => {
      if (isHandled) return;
      isHandled = true;
      resolve({
        status: "unavailable",
        error: `Network error connecting to OSV API: ${err.message}`,
      });
    });

    req.write(postData);
    req.end();
  });
}
