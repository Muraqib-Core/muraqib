import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createScanIssue, type FindingSeverity, type ScanIssue, type ScanIssueInput } from "../../core/findings/finding.js";
import type { ScanResult } from "../../core/contracts/scanner-engine.js";

const execFileAsync = promisify(execFile);
export type CommandRunner = (command: string, args: string[]) => Promise<string>;
const defaultRunner: CommandRunner = async (command, args) =>
  (await execFileAsync(command, args, { timeout: 120_000, maxBuffer: 16 * 1024 * 1024 })).stdout;

interface TrivyVulnerability {
  VulnerabilityID?: string;
  PkgName?: string;
  InstalledVersion?: string;
  FixedVersion?: string;
  Severity?: string;
  SeveritySource?: string;
  Title?: string;
}
interface TrivyResult { Target?: string; Class?: string; Type?: string; Vulnerabilities?: TrivyVulnerability[] }
interface TrivyReport { ArtifactName?: string; Results?: TrivyResult[]; Metadata?: { ImageID?: string } }

const severities = new Set<FindingSeverity>(["critical", "high", "medium", "low"]);
function severity(value?: string): FindingSeverity {
  const normalized = value?.toLowerCase() as FindingSeverity;
  return severities.has(normalized) ? normalized : "info";
}
function label(value: unknown): string {
  // eslint-disable-next-line no-control-regex
  return typeof value === "string" ? value.replace(/[\r\n\x00-\x1f]/g, " ").slice(0, 220) : "unknown";
}

/** Normalize only advisory/package metadata. Trivy's raw JSON can contain secrets; never return it. */
export function parseTrivyReport(input: unknown, imageId: string, scannedAt: string = new Date().toISOString()): ScanIssue[] {
  const report = input as TrivyReport;
  if (!report || !Array.isArray(report.Results) || report.Results.length === 0) throw new Error("Missing package inventory in Trivy result");
  const findings: ScanIssueInput[] = [];
  const seen = new Set<string>();
  for (const result of report.Results) {
    if (!result || !Array.isArray(result.Vulnerabilities)) continue;
    for (const vuln of result.Vulnerabilities) {
      if (!vuln?.VulnerabilityID || !vuln.PkgName || !vuln.InstalledVersion) continue;
      const id = `${result.Target ?? ""}|${vuln.PkgName}|${vuln.InstalledVersion}|${vuln.VulnerabilityID}`;
      if (seen.has(id)) continue;
      seen.add(id);
      findings.push({
        id: label(vuln.VulnerabilityID),
        title: `Known vulnerability in ${label(vuln.PkgName)}`,
        message: `${label(vuln.PkgName)}@${label(vuln.InstalledVersion)} in ${label(result.Target)} is affected by ${label(vuln.VulnerabilityID)}.`,
        severity: severity(vuln.Severity), category: "security", source: "trivy-image", confidence: "confirmed",
        file: imageId, evidence: `ecosystem=${label(result.Type)}; fixed=${label(vuln.FixedVersion ?? "not reported")}; severitySource=${label(vuln.SeveritySource)}`,
        imageProblem: {
          imageId, target: label(result.Target), ecosystem: label(result.Type), package: label(vuln.PkgName),
          installedVersion: label(vuln.InstalledVersion), advisoryId: label(vuln.VulnerabilityID),
          scannedAt, ...(vuln.FixedVersion ? { fixedVersion: label(vuln.FixedVersion) } : {}),
          ...(vuln.SeveritySource ? { severitySource: label(vuln.SeveritySource) } : {}),
        },
        remediation: vuln.FixedVersion ? `Evaluate upgrade to ${label(vuln.FixedVersion)}.` : "Check the advisory and vendor guidance for a fix.",
      });
    }
  }
  return findings.map(createScanIssue);
}

export class DockerImageScanner {
  constructor(private readonly run: CommandRunner = defaultRunner) {}

  /** Only a user-selected image already in the local Docker store is scanned. */
  async scan(image: string): Promise<ScanResult> {
  // eslint-disable-next-line no-control-regex
    if (!image || image.startsWith("-") || /[\x00-\x1f]/.test(image)) {
      return { scanner: "docker-image", status: "failed", findings: [], error: "Invalid image reference." };
    }
    let imageId: string;
    try {
      imageId = (await this.run("docker", ["image", "inspect", "--format", "{{.Id}}", image])).trim();
      if (!/^sha256:[a-f0-9]{64}$/i.test(imageId)) throw new Error("invalid digest");
    } catch {
      return { scanner: "docker-image", status: "unavailable", findings: [], skippedInputs: [image], diagnostics: ["Selected image is not available in the local Docker store, or Docker Engine is inaccessible. No image was pulled."] };
    }
    let output: string;
    try {
      // --image-src docker disables the default remote-registry fallback. Trivy may still refresh its advisory DB.
      output = await this.run("trivy", ["image", "--image-src", "docker", "--scanners", "vuln", "--format", "json", "--no-progress", imageId]);
    } catch {
      return { scanner: "docker-image", status: "unavailable", findings: [], skippedInputs: [imageId], diagnostics: ["Trivy is unavailable or image/advisory analysis failed. Image vulnerability coverage is incomplete."] };
    }
    try {
      const findings = parseTrivyReport(JSON.parse(output) as unknown, imageId);
      return { scanner: "docker-image", status: "success", findings, scannedInputs: [imageId], diagnostics: ["Local image packages were checked against the advisory database available to Trivy at scan time."] };
    } catch {
      return { scanner: "docker-image", status: "failed", findings: [], skippedInputs: [imageId], error: "The image analyzer returned an invalid or incomplete report." };
    }
  }
}
