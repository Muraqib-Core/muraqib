/**
 * OSV API Client
 * Communicates with the Open Source Vulnerabilities (OSV) API
 * to query known vulnerabilities in npm packages.
 */

export interface OSVVulnerability {
  id: string;
  published: string;
  modified: string;
  withdrawn?: string;
  aliases: string[];
  related: string[];
  summary: string;
  details?: string;
  affected: Array<{
    package: {
      ecosystem: string;
      name: string;
    };
    ranges: Array<{
      type: string;
      events: Array<{
        introduced?: string;
        fixed?: string;
      }>;
    }>;
  }>;
  references: Array<{
    type: string;
    url: string;
  }>;
  severity: Array<{
    type: string;
    score: string;
  }>;
}

export interface OSVQueryRequest {
  package: {
    ecosystem: string;
    name: string;
  };
  version?: string;
}

export interface OSVQueryResponse {
  vulns: OSVVulnerability[];
}

export class OSVClient {
  private readonly baseUrl: string = "https://api.osv.dev/v1";
  private readonly timeout: number = 10000;

  async query(request: OSVQueryRequest): Promise<OSVVulnerability[]> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(`${this.baseUrl}/query`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(
          `OSV API error: ${response.status} ${response.statusText}`
        );
      }

      const data = (await response.json()) as OSVQueryResponse;
      return data.vulns || [];
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`OSV API timeout after ${this.timeout}ms`);
      }
      throw error;
    }
  }

  async queryBatch(
    requests: OSVQueryRequest[]
  ): Promise<Map<string, OSVVulnerability[]>> {
    const results = new Map<string, OSVVulnerability[]>();

    for (const request of requests) {
      const packageKey = `${request.package.name}@${request.version || "*"}`;
      try {
        const vulns = await this.query(request);
        results.set(packageKey, vulns);
      } catch {
        results.set(packageKey, []);
      }
    }

    return results;
  }

  isCritical(vuln: OSVVulnerability): boolean {
    const severity = vuln.severity || [];
    return severity.some(
      (s) =>
        s.type === "CVSS_V3" &&
        parseFloat(s.score) >= 9.0
    );
  }

  isHighSeverity(vuln: OSVVulnerability): boolean {
    const severity = vuln.severity || [];
    return severity.some(
      (s) =>
        s.type === "CVSS_V3" &&
        parseFloat(s.score) >= 7.0
    );
  }
}
