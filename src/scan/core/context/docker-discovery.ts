import * as fs from "node:fs";
import * as path from "node:path";

export interface DockerDiscoveryResult {
  dockerfiles: string[];
  composeFiles: string[];
  dockerignoreFiles: string[];
}

const IGNORE_DIRS = new Set([
  "node_modules",
  "dist",
  ".git",
  "vendor",
  "build",
  "out",
  ".next",
  "coverage"
]);

const COMPOSE_NAMES = new Set([
  "compose.yaml",
  "compose.yml",
  "docker-compose.yml",
  "docker-compose.yaml",
  "compose.override.yaml",
  "compose.override.yml",
  "docker-compose.override.yaml",
  "docker-compose.override.yml",
]);

const MAX_DEPTH = 10;

/** What a directory entry is once symlinks are followed; undefined for a link that escapes the root or is broken. */
function resolveEntryKind(
  entry: fs.Dirent,
  fullPath: string,
  rootAbsolute: string
): { isDir: boolean; isFile: boolean; targetName: string } | undefined {
  if (!entry.isSymbolicLink()) {
    return { isDir: entry.isDirectory(), isFile: entry.isFile(), targetName: entry.name };
  }
  try {
    const realPath = fs.realpathSync(fullPath);
    if (realPath !== rootAbsolute && !realPath.startsWith(rootAbsolute + path.sep)) return undefined; // prevent symlink escape
    const stat = fs.statSync(realPath);
    return { isDir: stat.isDirectory(), isFile: stat.isFile(), targetName: path.basename(realPath) };
  } catch {
    return undefined;
  }
}

/** Lists a directory, or returns undefined when it was already visited (by real path) or cannot be read. */
function readUnvisitedDir(dir: string, visited: Set<string>): fs.Dirent[] | undefined {
  let resolvedDir: string;
  try {
    resolvedDir = fs.realpathSync(dir);
  } catch {
    return undefined;
  }
  if (visited.has(resolvedDir)) return undefined;
  visited.add(resolvedDir);

  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return undefined;
  }
}

/** Which of the result lists a file name belongs to, if any. */
function discoveryKind(lowerName: string): keyof DockerDiscoveryResult | undefined {
  if (lowerName === "dockerfile" || lowerName.startsWith("dockerfile.")) return "dockerfiles";
  if (lowerName === ".dockerignore") return "dockerignoreFiles";
  if (COMPOSE_NAMES.has(lowerName)) return "composeFiles";
  return undefined;
}

/**
 * Discover docker files.
 *
 * @param projectRoot - Project root
 * @returns Discover docker files result
 */
export function discoverDockerFiles(projectRoot: string): DockerDiscoveryResult {
  const found: DockerDiscoveryResult = { dockerfiles: [], composeFiles: [], dockerignoreFiles: [] };

  const rootAbsolute = path.resolve(projectRoot);
  const visited = new Set<string>();

  function walk(dir: string, depth: number = 0): void {
    if (depth > MAX_DEPTH) return; // Bound traversal

    const entries = readUnvisitedDir(dir, visited);
    if (!entries) return;

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const kind = resolveEntryKind(entry, fullPath, rootAbsolute);
      if (!kind) continue;

      if (kind.isDir) {
        const ignored = IGNORE_DIRS.has(entry.name) || (entry.isSymbolicLink() && IGNORE_DIRS.has(kind.targetName));
        if (!ignored) walk(fullPath, depth + 1);
      } else if (kind.isFile) {
        const list = discoveryKind(entry.name.toLowerCase());
        if (list) found[list].push(path.relative(rootAbsolute, fullPath));
      }
    }
  }

  walk(rootAbsolute);

  return {
    dockerfiles: found.dockerfiles.sort(),
    composeFiles: found.composeFiles.sort(),
    dockerignoreFiles: found.dockerignoreFiles.sort(),
  };
}
