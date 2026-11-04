/**
 * Compose file grouping: which override files merge into which base file.
 */
import path from "node:path";

const BASE_COMPOSE = /^(?:docker-)?compose\.ya?ml$/;

/** A `compose.override.yml` next to a base compose file is merged into it, not scanned on its own. */
export function isSupersededOverride(file: string, allCompose: string[]): boolean {
  const baseName = path.basename(file).toLowerCase();
  return /^(?:docker-)?compose\.override\.ya?ml$/.test(baseName) && allCompose.some(other =>
    path.dirname(other) === path.dirname(file) && BASE_COMPOSE.test(path.basename(other).toLowerCase()));
}

/** The file followed by the override files that merge into it (an override file stands alone). */
export function composeMembers(file: string, allCompose: string[]): string[] {
  const baseName = path.basename(file).toLowerCase();
  if (/\.override\./.test(baseName)) return [file];
  const prefix = baseName.startsWith("docker-") ? "docker-compose" : "compose";
  const override = allCompose.filter(other => path.dirname(other) === path.dirname(file) &&
    new RegExp(`^${prefix}\\.override\\.ya?ml$`).test(path.basename(other).toLowerCase()));
  return [file, ...override];
}
