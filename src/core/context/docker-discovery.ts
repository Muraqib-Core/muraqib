/**
 * Docker Discovery Module
 * Automatically detects Docker-related files and configurations in project
 */

import * as fs from "fs";
import { join } from "path";

export interface DockerDiscoveryResult {
  hasDocker: boolean;
  hasDockerCompose: boolean;
  hasDockerignore: boolean;
  dockerFileVariants: string[];
  composeFileVariants: string[];
  containerConfig: {
    baseImage?: string;
    hasHealthCheck: boolean;
    runAsRoot: boolean;
    hasSecrets: boolean;
  };
}

const DOCKERFILE_VARIANTS = [
  "Dockerfile",
  "Dockerfile.dev",
  "Dockerfile.prod",
  "Dockerfile.test",
];

const COMPOSE_VARIANTS = [
  "docker-compose.yml",
  "docker-compose.yaml",
  "compose.yml",
  "compose.yaml",
  "docker-compose.dev.yml",
  "docker-compose.prod.yml",
];

/**
 * Discover Docker configurations in project root
 * Scans for Dockerfile variants, docker-compose files, and security settings
 */
export function discoverDockerConfig(
  projectRoot: string
): DockerDiscoveryResult {
  const dockerFileVariants: string[] = [];
  const composeFileVariants: string[] = [];

  // Check for Dockerfile variants
  for (const variant of DOCKERFILE_VARIANTS) {
    const filePath = join(projectRoot, variant);
    if (fs.existsSync(filePath)) {
      dockerFileVariants.push(variant);
    }
  }

  // Check for docker-compose variants
  for (const variant of COMPOSE_VARIANTS) {
    const filePath = join(projectRoot, variant);
    if (fs.existsSync(filePath)) {
      composeFileVariants.push(variant);
    }
  }

  const hasDocker = dockerFileVariants.length > 0;
  const hasDockerCompose = composeFileVariants.length > 0;
  const dockerignorePath = join(projectRoot, ".dockerignore");
  const hasDockerignore = fs.existsSync(dockerignorePath);

  const containerConfig = {
    baseImage: undefined as string | undefined,
    hasHealthCheck: false,
    runAsRoot: false,
    hasSecrets: false,
  };

  // Analyze first Dockerfile if exists
  if (dockerFileVariants.length > 0) {
    const dockerfilePath = join(projectRoot, dockerFileVariants[0]!);
    try {
      const content = fs.readFileSync(dockerfilePath, "utf-8");
      containerConfig.baseImage = extractBaseImage(content);
      containerConfig.hasHealthCheck = content.includes("HEALTHCHECK");
      containerConfig.runAsRoot = checkIfRunsAsRoot(content);
      containerConfig.hasSecrets = containsHardcodedSecrets(content);
    } catch {
      // Silently ignore read errors
    }
  }

  return {
    hasDocker,
    hasDockerCompose,
    hasDockerignore,
    dockerFileVariants,
    composeFileVariants,
    containerConfig,
  };
}

/**
 * Extract base image from Dockerfile content
 */
function extractBaseImage(content: string): string | undefined {
  const match = content.match(/FROM\s+([\w/:.-]+)/);
  return match ? match[1] : undefined;
}

/**
 * Check if container configuration runs as root user
 */
function checkIfRunsAsRoot(content: string): boolean {
  // If USER directive is explicitly set to non-root, it's not root
  const userMatches = content.match(/USER\s+(\w+)/g);
  if (userMatches && userMatches.length > 0) {
    for (const match of userMatches) {
      const user = match.replace("USER", "").trim();
      if (user !== "root" && user !== "0") {
        return false;
      }
    }
    // All USER directives are root or 0, so it runs as root
    return true;
  }

  // Default: runs as root if no USER directive
  return true;
}

/**
 * Detect hardcoded secrets in Dockerfile
 */
function containsHardcodedSecrets(content: string): boolean {
  const secretPatterns = [
    /password\s*=\s*[^$]/i,
    /api[_-]?key\s*=\s*[^$]/i,
    /secret\s*=\s*[^$]/i,
    /token\s*=\s*[^$]/i,
    /aws[_-]?access[_-]?key/i,
    /aws[_-]?secret[_-]?key/i,
    /private[_-]?key/i,
  ];

  return secretPatterns.some((pattern) => pattern.test(content));
}

/**
 * Find all Docker-related files in project directory tree
 */
export function findDockerFiles(projectRoot: string): string[] {
  const dockerRelatedFiles: string[] = [];
  const dockerPatterns = [
    /^Dockerfile/,
    /^docker-compose/,
    /^\.dockerignore$/,
    /^\.dockerauth/,
  ];

  try {
    const files = fs.readdirSync(projectRoot);
    for (const file of files) {
      if (dockerPatterns.some((pattern) => pattern.test(file))) {
        dockerRelatedFiles.push(file);
      }
    }
  } catch {
    // Silently ignore read errors
  }

  return dockerRelatedFiles;
}

/**
 * Determine if project is containerized
 */
export function isContainerized(projectRoot: string): boolean {
  const discovery = discoverDockerConfig(projectRoot);
  return discovery.hasDocker || discovery.hasDockerCompose;
}

/**
 * Get Docker-related file paths for a project
 */
export function getDockerFilePaths(projectRoot: string): {
  dockerfiles: string[];
  composeFiles: string[];
  dockerignore?: string;
} {
  const discovery = discoverDockerConfig(projectRoot);

  return {
    dockerfiles: discovery.dockerFileVariants.map((f) => join(projectRoot, f)),
    composeFiles: discovery.composeFileVariants.map((f) =>
      join(projectRoot, f)
    ),
    dockerignore: discovery.hasDockerignore
      ? join(projectRoot, ".dockerignore")
      : undefined,
  };
}
