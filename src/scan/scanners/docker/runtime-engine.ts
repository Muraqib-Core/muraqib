import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createScanIssue, type ScanIssue, type ScanIssueInput } from "../../core/findings/finding.js";
import type { ScanResult } from "../../core/contracts/scanner-engine.js";
import type { CommandRunner } from "./image-engine.js";

const execFileAsync = promisify(execFile);
const defaultRunner: CommandRunner = async (command, args) =>
  (await execFileAsync(command, args, { timeout: 10_000, maxBuffer: 2 * 1024 * 1024 })).stdout;

interface ContainerInspect {
  Id?: string;
  Name?: string;
  Config?: { User?: string; Image?: string };
  HostConfig?: {
    Privileged?: boolean; CapAdd?: string[] | null; NetworkMode?: string; PidMode?: string; IpcMode?: string;
    Memory?: number; NanoCpus?: number; PidsLimit?: number; SecurityOpt?: string[] | null;
  };
  Mounts?: Array<{ Source?: string; Destination?: string }>;
  NetworkSettings?: { Ports?: Record<string, Array<{ HostIp?: string; HostPort?: string }> | null> };
}
function finding(id: string, title: string, message: string, severity: ScanIssueInput["severity"], container: string): ScanIssueInput {
  return { id, title, message, severity, category: "security", source: "docker-runtime", confidence: "confirmed", file: container };
}

export function analyzeContainer(input: unknown): ScanIssue[] {
  const container = input as ContainerInspect;
  if (!container || typeof container.Id !== "string" || !container.HostConfig) throw new Error("Invalid container inspect result");
  const id = container.Id.slice(0, 12);
  const host = container.HostConfig;
  const findings: ScanIssueInput[] = [];
  if (host.Privileged) findings.push(finding("RT-PRIVILEGED", "Privileged container", "The running container has privileged mode enabled.", "high", id));
  if (container.Mounts?.some(m => m.Source === "/var/run/docker.sock" || m.Source === "/run/docker.sock"))
    findings.push(finding("RT-DOCKER-SOCKET", "Docker socket mounted", "The running container mounts the Docker daemon socket.", "critical", id));
  if (host.CapAdd?.some(c => c === "ALL" || c === "SYS_ADMIN")) findings.push(finding("RT-CAPABILITY", "Broad capability added", "The running container has a broad Linux capability.", "high", id));
  if ([host.NetworkMode, host.PidMode, host.IpcMode].includes("host")) findings.push(finding("RT-HOST-NAMESPACE", "Host namespace shared", "The running container shares a host namespace.", "medium", id));
  if (container.Config?.User === "0" || container.Config?.User === "root") findings.push(finding("RT-ROOT", "Container configured as root", "The container image configuration selects the root user; inspect process overrides separately.", "medium", id));
  return findings.map(createScanIssue);
}

export class DockerRuntimeScanner {
  constructor(private readonly run: CommandRunner = defaultRunner) {}
  async scan(container: string): Promise<ScanResult> {
  // eslint-disable-next-line no-control-regex
    if (!container || container.startsWith("-") || /[\x00-\x1f]/.test(container)) return { scanner: "docker-runtime", status: "failed", findings: [], error: "Invalid container target." };
    try {
      // Explicit read-only inspection; never starts, stops, or changes a container.
      const output = await this.run("docker", ["inspect", "--type", "container", container]);
      const result = JSON.parse(output) as unknown;
      if (!Array.isArray(result) || result.length !== 1) throw new Error("Invalid inspect output");
      const findings = analyzeContainer(result[0]);
      const id = (result[0] as ContainerInspect).Id!.slice(0, 12);
      return { scanner: "docker-runtime", status: "success", findings, scannedInputs: [id], diagnostics: ["Inspected effective container settings; host daemon policy and Engine CVEs were not assessed."] };
    } catch {
      return { scanner: "docker-runtime", status: "unavailable", findings: [], skippedInputs: [container], diagnostics: ["Container inspection failed or Docker Engine is inaccessible. Runtime coverage is incomplete."] };
    }
  }
}
