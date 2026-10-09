import { BaseGuard } from "./base-guard.js";
import type { AuditResult, AuditContext } from "./types.js";
import { createProjectContext } from "../scan/core/context/project-context.js";
import { DockerScanner } from "../scan/scanners/docker/docker-engine.js";
import { findingToAuditIssue } from "../scan/bridge.js";

interface DockerAuditOptions {
  projectRoot?: string;
  /** Opt in to Docker-CLI-backed build / effective compose validation. */
  nativeValidation?: boolean;
}

/**
 * Guard-layer adapter over the scan layer's DockerScanner (Dockerfile, compose, .dockerignore rules).
 * Replaces the earlier naive string-matching implementation.
 */
export class DockerGuard extends BaseGuard {
  private options: DockerAuditOptions;

  constructor(options: DockerAuditOptions = {}, context?: AuditContext) {
    super("docker-guard", context);
    this.options = options;
  }

  async execute(): Promise<AuditResult> {
    const root = this.options.projectRoot ?? process.cwd();
    const project = createProjectContext(root);
    const scanner = new DockerScanner(undefined, this.options.nativeValidation ?? false);
    const scanContext = {
      projectPath: project.projectPath,
      files: project.files,
      packageManager: project.packageManager,
      dockerfiles: project.dockerfiles,
      composeFiles: project.composeFiles,
      dockerignoreFiles: project.dockerignoreFiles,
    };

    if (!scanner.supports(scanContext)) {
      return this.ok("No Dockerfile or compose file detected; Docker checks skipped");
    }

    const result = await scanner.scan(scanContext);
    if (result.status === "failed") {
      return this.issues(
        [this.createIssue("DOCKER_SCAN_FAILED", "error", "Docker scan failed", result.error ?? "Docker scan failed", undefined, "Check the Docker files are readable")],
        "Docker scan failed"
      );
    }

    const issues = result.findings.map(findingToAuditIssue);
    if (issues.length === 0) return this.ok("Docker configuration passed all checks");
    return this.issues(issues, `Found ${issues.length} Docker issue(s)`);
  }
}
