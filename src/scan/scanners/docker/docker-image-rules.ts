/**
 * Dockerfile base-image rules: end-of-life releases, mutable tags and root users.
 */

/**
 * Oldest release of an official image that still receives upstream security fixes, as [major, minor].
 * Review this table when upstream support windows change.
 */
const MIN_SUPPORTED: Record<string, readonly [number, number]> = {
  node: [22, 0],
  python: [3, 10],
  ubuntu: [22, 4],
  debian: [12, 0],
};

/** Returns "name:version" when the image is an official, end-of-life release; otherwise null. */
export function endOfLifeRelease(image: string): string | null {
  const match = /^(?:docker\.io\/)?(?:library\/)?(node|python|ubuntu|debian):(\d+)(?:\.(\d+))?(?:[.\-@]|$)/i.exec(image);
  const name = match?.[1]?.toLowerCase();
  const minimum = name ? MIN_SUPPORTED[name] : undefined;
  if (!name || !minimum || !match?.[2]) return null;
  const major = Number(match[2]);
  const minor = Number(match[3] ?? 0);
  const eol = major < minimum[0] || (major === minimum[0] && minor < minimum[1]);
  return eol ? `${name}:${match[2]}${match[3] !== undefined ? `.${match[3]}` : ""}` : null;
}

export function runsAsRoot(user: string | undefined): boolean {
  if (user === undefined) return true;
  const name = (user.split(":")[0] ?? "").toLowerCase();
  return name === "root" || name === "0";
}

export interface DockerfileStage {
  alias?: string;
  line: number;
  user: string | undefined;
  scratch: boolean;
}

export interface DockerfileState {
  aliases: Set<string>;
  args: Map<string, string>;
  /** Effective USER per named stage, so a final stage built FROM an earlier stage inherits it. */
  stageUsers: Map<string, string | undefined>;
  stage: DockerfileStage | null;
}

/** An image with an explicit `:latest` tag, or with neither a tag nor a digest. */
export function isMutableTag(image: string): boolean {
  return image.endsWith(":latest") || (!image.includes(":") && !image.includes("@"));
}
