import https from "node:https";
import http from "node:http";
import { osvConfig } from "../../config/osv.config.js";

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

export function queryOsv(
  packageName: string,
  version: string
): Promise<OsvQueryResult> {
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
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });

      res.on("end", () => {
        if (isHandled) return;
        isHandled = true;

        // if (res.statusCode && (res.statusCode >= 500 || res.statusCode === 429)) {
        //   resolve({
        //     status: "unavailable",
        //     error: `OSV service returned HTTP status ${res.statusCode}`,
        //   });
        //   return;
        // }
        if (Buffer.byteLength(data) > 5 * 1024 * 1024) {
          req.destroy(
            new Error("OSV response exceeded the 5 MiB safety limit")
          );
        }
        if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
          resolve({
            status: "unavailable",
            error: `OSV service returned HTTP status ${res.statusCode}`,
          });
          return;
        }

        try {
          const parsed = JSON.parse(data) as OsvResponse;
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
