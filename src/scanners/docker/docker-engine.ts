/**
 * Docker Security & Performance Scanner Engine
 * Comprehensive Dockerfile analysis for best practices in security and performance
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { BaseGuard } from "../../core/base-guard.js";
import type { AuditResult, AuditIssue, AuditContext } from "../../core/types.js";

export interface DockerfileLine {
  lineNumber: number;
  instruction: string;
  value: string;
}

export interface DockerScanOptions {
  projectRoot: string;
  checkCompose?: boolean;
  checkDockerignore?: boolean;
}

function parseDockerfile(content: string): DockerfileLine[] {
  return content
    .split("\n")
    .map((line, index) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        return null;
      }
      const match = trimmed.match(/^([A-Z_]+)\s+(.*)/);
      if (match) {
        return {
          lineNumber: index + 1,
          instruction: match[1],
          value: match[2] || "",
        };
      }
      return null;
    })
    .filter((line): line is DockerfileLine => line !== null);
}

function getDockerfileContent(projectRoot: string): string | null {
  const dockerfilePath = join(projectRoot, "Dockerfile");
  if (!existsSync(dockerfilePath)) {
    return null;
  }
  try {
    return readFileSync(dockerfilePath, "utf-8");
  } catch {
    return null;
  }
}

function getComposeFileContent(projectRoot: string): string | null {
  const composeFiles = [
    "docker-compose.yml",
    "docker-compose.yaml",
    "compose.yml",
    "compose.yaml",
  ];
  for (const file of composeFiles) {
    const filePath = join(projectRoot, file);
    if (existsSync(filePath)) {
      try {
        return readFileSync(filePath, "utf-8");
      } catch {
        continue;
      }
    }
  }
  return null;
}

export class DockerEngine extends BaseGuard {
  private options: DockerScanOptions;

  constructor(options: DockerScanOptions, context?: AuditContext) {
    super("docker-security-engine", context);
    this.options = {
      checkCompose: true,
      checkDockerignore: true,
      ...options,
    };
  }

  async execute(): Promise<AuditResult> {
    try {
      const dockerfileContent = getDockerfileContent(this.options.projectRoot);

      if (!dockerfileContent) {
        return this.ok(
          "No Dockerfile detected. Application may not be containerized."
        );
      }

      const issues: AuditIssue[] = [];

      const dockerfileIssues = this.analyzeDockerfile(dockerfileContent);
      issues.push(...dockerfileIssues);

      if (this.options.checkDockerignore) {
        const dockerignoreIssues = this.checkDockerignore();
        issues.push(...dockerignoreIssues);
      }

      if (this.options.checkCompose) {
        const composeIssues = this.analyzeDockerCompose();
        issues.push(...composeIssues);
      }

      if (issues.length === 0) {
        return this.ok(
          "Dockerfile configuration follows security best practices"
        );
      }

      return this.issues(
        issues,
        `Found ${issues.length} Docker configuration issue(s)`
      );
    } catch (error) {
      return this.createErrorResult(error);
    }
  }

  private analyzeDockerfile(content: string): AuditIssue[] {
    const issues: AuditIssue[] = [];
    const lines = parseDockerfile(content);

    let hasHealthCheck = false;
    let hasNonRootUser = false;
    let baseImageFound = false;

    for (const line of lines) {
      // Check FROM instruction
      if (line.instruction === "FROM") {
        baseImageFound = true;
        if (this.hasUnpinnedVersion(line.value)) {
          issues.push(
            this.createIssue(
              "DOCKER_UNPINNED_BASE_IMAGE",
              "error",
              "Unpinned base image version",
              `Line ${line.lineNumber}: Base image uses imprecise version tag '${line.value}'. Pin to specific version for reproducibility.`,
              { file: "Dockerfile", line: line.lineNumber },
              "Use specific version: 'FROM node:20.10.0-alpine' instead of 'FROM node:latest'"
            )
          );
        }

        if (this.isLargeBaseImage(line.value)) {
          issues.push(
            this.createIssue(
              "DOCKER_LARGE_BASE_IMAGE",
              "warning",
              "Large base image detected",
              `Line ${line.lineNumber}: Base image '${line.value}' is large. Consider alpine variant for smaller images.`,
              { file: "Dockerfile", line: line.lineNumber },
              "Use Alpine Linux: 'FROM node:20-alpine' for 10x smaller images"
            )
          );
        }
      }

      // Check USER instruction
      if (line.instruction === "USER") {
        if (line.value.includes("root") || line.value === "0") {
          issues.push(
            this.createIssue(
              "DOCKER_ROOT_USER",
              "critical",
              "Container runs as root",
              `Line ${line.lineNumber}: Application runs as root user, creating a security vulnerability. If compromised, attacker has full system access.`,
              { file: "Dockerfile", line: line.lineNumber },
              "Create non-root user: 'RUN useradd -m appuser' and 'USER appuser'"
            )
          );
        } else {
          hasNonRootUser = true;
        }
      }

      // Check HEALTHCHECK instruction
      if (line.instruction === "HEALTHCHECK") {
        hasHealthCheck = true;
      }

      // Check for hardcoded secrets
      if (["ENV", "RUN", "ARG"].includes(line.instruction)) {
        if (this.containsSecrets(line.value)) {
          issues.push(
            this.createIssue(
              "DOCKER_HARDCODED_SECRETS",
              "critical",
              "Hardcoded secrets in Dockerfile",
              `Line ${line.lineNumber}: Detected potential hardcoded secret. Secrets in Dockerfile are baked into image and visible to all users.`,
              { file: "Dockerfile", line: line.lineNumber },
              "Use Docker secrets, build arguments, or environment variables from secure management system"
            )
          );
        }
      }

      // Check for unnecessary sudo
      if (line.instruction === "RUN" && line.value.includes("sudo")) {
        issues.push(
          this.createIssue(
            "DOCKER_SUDO_USAGE",
            "warning",
            "Unnecessary sudo in RUN instruction",
            `Line ${line.lineNumber}: sudo is unnecessary inside Docker containers. Run as root with 'RUN' or use non-root user.`,
            { file: "Dockerfile", line: line.lineNumber },
            "Remove sudo and run commands directly or use USER directive"
          )
        );
      }

      // Check for apt-get without cleanup
      if (
        line.instruction === "RUN" &&
        line.value.includes("apt-get install")
      ) {
        if (
          !line.value.includes("apt-get clean") &&
          !line.value.includes("rm -rf /var/lib/apt")
        ) {
          issues.push(
            this.createIssue(
              "DOCKER_APT_CACHE_NOT_CLEANED",
              "warning",
              "apt-get cache not cleaned",
              `Line ${line.lineNumber}: apt-get package lists left in image. This increases image size unnecessarily.`,
              { file: "Dockerfile", line: line.lineNumber },
              "Add '&& apt-get clean && rm -rf /var/lib/apt/lists/*' to RUN instruction"
            )
          );
        }
      }
    }

    // Check missing FROM
    if (!baseImageFound) {
      issues.push(
        this.createIssue(
          "DOCKER_NO_BASE_IMAGE",
          "critical",
          "No base image specified",
          "Dockerfile must start with FROM instruction to specify base image",
          { file: "Dockerfile" },
          "Add 'FROM node:20-alpine' as first instruction"
        )
      );
    }

    // Check missing HEALTHCHECK
    if (!hasHealthCheck) {
      issues.push(
        this.createIssue(
          "DOCKER_NO_HEALTHCHECK",
          "warning",
          "Missing HEALTHCHECK instruction",
          "No health check defined for container. This prevents orchestrators from detecting unhealthy instances.",
          { file: "Dockerfile" },
          "Add HEALTHCHECK: HEALTHCHECK --interval=30s --timeout=10s CMD node /healthcheck.js"
        )
      );
    }

    // Check for non-root user
    if (!hasNonRootUser && lines.some((l) => l.instruction === "RUN")) {
      issues.push(
        this.createIssue(
          "DOCKER_NO_NON_ROOT_USER",
          "error",
          "No non-root user configured",
          "Application runs with default user (often root). Best practice is to create and use non-root user.",
          { file: "Dockerfile" },
          "Create non-root user with 'RUN useradd -m appuser' and set 'USER appuser'"
        )
      );
    }

    return issues;
  }

  private checkDockerignore(): AuditIssue[] {
    const issues: AuditIssue[] = [];
    const dockerignorePath = join(this.options.projectRoot, ".dockerignore");

    if (!existsSync(dockerignorePath)) {
      issues.push(
        this.createIssue(
          "DOCKER_MISSING_DOCKERIGNORE",
          "warning",
          "Missing .dockerignore file",
          ".dockerignore helps exclude unnecessary files from Docker build context, reducing build time and image size.",
          { file: ".dockerignore" },
          "Create .dockerignore with: node_modules, .git, .env, dist, build, etc."
        )
      );
      return issues;
    }

    try {
      readFileSync(dockerignorePath, "utf-8");

      // .dockerignore file exists and is readable
      // No additional checks needed - just its presence is sufficient
    } catch {
      issues.push(
        this.createIssue(
          "DOCKER_DOCKERIGNORE_READ_ERROR",
          "warning",
          "Error reading .dockerignore",
          "Failed to read .dockerignore file for analysis",
          { file: ".dockerignore" },
          "Verify .dockerignore file permissions and format"
        )
      );
    }

    return issues;
  }

  private analyzeDockerCompose(): AuditIssue[] {
    const issues: AuditIssue[] = [];
    const composeContent = getComposeFileContent(this.options.projectRoot);

    if (!composeContent) {
      return issues;
    }

    // Basic YAML checks
    if (
      composeContent.includes("privileged: true") &&
      !composeContent.includes("#")
    ) {
      issues.push(
        this.createIssue(
          "DOCKER_COMPOSE_PRIVILEGED_MODE",
          "error",
          "Container running in privileged mode",
          "Privileged containers have unrestricted access to host devices, creating security risk",
          { file: "docker-compose.yml" },
          "Remove 'privileged: true' unless absolutely necessary. Use capabilities instead."
        )
      );
    }

    if (composeContent.includes("network_mode: host")) {
      issues.push(
        this.createIssue(
          "DOCKER_COMPOSE_HOST_NETWORK",
          "error",
          "Container using host network mode",
          "Host network mode bypasses container network isolation",
          { file: "docker-compose.yml" },
          "Use bridge network or custom networks instead of host mode"
        )
      );
    }

    if (!composeContent.includes("restart_policy")) {
      issues.push(
        this.createIssue(
          "DOCKER_COMPOSE_NO_RESTART_POLICY",
          "warning",
          "No restart policy defined",
          "Container will not automatically restart on failure",
          { file: "docker-compose.yml" },
          "Add 'restart_policy: {condition: on-failure, max_retries: 3}'"
        )
      );
    }

    return issues;
  }

  private hasUnpinnedVersion(fromValue: string): boolean {
    return (
      fromValue.includes("latest") ||
      fromValue.includes(":") === false ||
      /:\d+$/.test(fromValue)
    );
  }

  private isLargeBaseImage(fromValue: string): boolean {
    const largeImages = [
      "ubuntu",
      "debian",
      "python",
      "node",
      "java",
      "golang",
    ];
    return (
      largeImages.some((img) => fromValue.includes(img)) &&
      !fromValue.includes("alpine") &&
      !fromValue.includes("slim")
    );
  }

  private containsSecrets(value: string): boolean {
    const secretPatterns = [
      /password\s*=\s*(?!.*\$)/i,
      /api[_-]?key\s*=\s*(?!.*\$)/i,
      /secret\s*=\s*(?!.*\$)/i,
      /token\s*=\s*(?!.*\$)/i,
      /aws[_-]?access[_-]?key/i,
      /aws[_-]?secret[_-]?key/i,
      /private[_-]?key/i,
      /oauth/i,
    ];

    return secretPatterns.some((pattern) => pattern.test(value));
  }
}

export async function performDockerScan(
  options: DockerScanOptions
): Promise<AuditResult> {
  const engine = new DockerEngine(options);
  return engine.run();
}
