import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { BaseGuard } from "./base-guard.js";
import type { AuditResult, AuditIssue, AuditContext } from "./types.js";

export interface DockerAuditResult {
  isSecure: boolean;
  reports: string[];
  dockerfileIssues: string[];
}

interface DockerAuditOptions {
  projectRoot?: string;
}

function performDockerAuditInternal(projectRoot?: string): DockerAuditResult {
  const root = projectRoot || process.cwd();
  const dockerfilePath = join(root, "Dockerfile");
  const dockerignorePath = join(root, ".dockerignore");

  const reports: string[] = [];
  const dockerfileIssues: string[] = [];
  let isSecure = true;

  if (!existsSync(dockerfilePath)) {
    reports.push(
      "⚠️ No Dockerfile detected. Consider containerizing your application."
    );
    return { isSecure: false, reports, dockerfileIssues };
  }

  if (!existsSync(dockerignorePath)) {
    reports.push(
      "⚠️ Missing .dockerignore file. Create one to exclude unnecessary files from Docker image."
    );
  }

  const dockerfileContent = readFileSync(dockerfilePath, "utf-8");
  const lines = dockerfileContent.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]?.trim() || "";

    if (line.startsWith("FROM")) {
      if (line.includes("latest")) {
        dockerfileIssues.push(
          `Line ${i + 1}: Pin specific Node.js version instead of 'latest'`
        );
        reports.push(
          `❌ Dockerfile:${i + 1} - Unpinned base image version (using 'latest')`
        );
        isSecure = false;
      }

      if (
        (line.includes("node:20") || line.includes("node:18")) &&
        !line.includes("alpine")
      ) {
        reports.push(
          `ℹ️ Dockerfile:${i + 1} - Consider using alpine variant for smaller image`
        );
      }
    }

    if (line.startsWith("USER") && line.includes("root")) {
      dockerfileIssues.push(
        `Line ${i + 1}: Running container as root is a security risk`
      );
      reports.push(
        `🔴 CRITICAL Dockerfile:${i + 1} - Container runs as root user`
      );
      isSecure = false;
    }

    if (
      (line.startsWith("ENV") || line.startsWith("RUN")) &&
      (line.includes("password") ||
        line.includes("token") ||
        line.includes("secret") ||
        line.includes("api_key"))
    ) {
      dockerfileIssues.push(
        `Line ${i + 1}: Detected hardcoded secrets in Dockerfile`
      );
      reports.push(
        `🔴 CRITICAL Dockerfile:${i + 1} - Hardcoded secrets detected`
      );
      isSecure = false;
    }
  }

  if (!dockerfileContent.includes("HEALTHCHECK")) {
    reports.push(
      "ℹ️ No HEALTHCHECK instruction found. Consider adding one for production deployments."
    );
  }

  if (isSecure && reports.length === 0) {
    reports.push("✅ Dockerfile configuration is secure and well-optimized");
  }

  return { isSecure, reports, dockerfileIssues };
}

export class DockerGuard extends BaseGuard {
  private options: DockerAuditOptions;

  constructor(options: DockerAuditOptions = {}, context?: AuditContext) {
    super("docker-guard", context);
    this.options = options;
  }

  async execute(): Promise<AuditResult> {
    const result = performDockerAuditInternal(this.options.projectRoot);

    const issues: AuditIssue[] = [];

    for (const report of result.reports) {
      let severity: AuditIssue["severity"] = "warning";
      if (report.includes("CRITICAL") || report.includes("root user") || report.includes("hardcoded secrets")) {
        severity = "critical";
      } else if (report.includes("❌")) {
        severity = "error";
      }

      issues.push(
        this.createIssue(
          `DOCKER_${report.split(":")[0]?.toUpperCase().replace(/\s+/g, "_") || "UNKNOWN"}`,
          severity,
          "Docker Configuration Issue",
          report,
          { file: "Dockerfile" },
          "Review and fix the Docker configuration"
        )
      );
    }

    if (issues.length === 0) {
      return this.ok("Dockerfile configuration is secure and well-optimized");
    }

    return this.issues(issues, `Found ${issues.length} Docker issue(s)`);
  }
}

/**
 * @deprecated Use DockerGuard class instead
 */
export function performDockerAudit(projectRoot?: string): DockerAuditResult {
  return performDockerAuditInternal(projectRoot);
}
