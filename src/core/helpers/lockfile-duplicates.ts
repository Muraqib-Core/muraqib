/** Map of package name to the distinct versions found in lock files. */
export type PackageVersions = Map<string, Set<string>>;

function addVersion(into: PackageVersions, name: string, version: string): void {
  if (name.length === 0 || version.length === 0) return;
  const versions = into.get(name) ?? new Set<string>();
  versions.add(version);
  into.set(name, versions);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function walkLegacyDependencies(deps: unknown, into: PackageVersions): void {
  if (!isRecord(deps)) return;
  for (const [name, entry] of Object.entries(deps)) {
    if (!isRecord(entry)) continue;
    const version = entry["version"];
    if (typeof version === "string" && !/^(?:file|link|git(?:\+[a-z]+)?|github|https?):/.test(version)) {
      addVersion(into, name, version);
    }
    walkLegacyDependencies(entry["dependencies"], into);
  }
}

/**
 * Collect package versions from a `package-lock.json` (lockfileVersion 1, 2 or 3).
 *
 * @param content - Raw lock file text
 * @param into - Map to add to
 */
export function collectNpmLockVersions(content: string, into: PackageVersions): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return;
  }
  if (!isRecord(parsed)) return;

  const packages = parsed["packages"];
  if (isRecord(packages)) {
    for (const [key, entry] of Object.entries(packages)) {
      if (key === "" || !isRecord(entry) || entry["link"] === true) continue;
      const version = entry["version"];
      if (typeof version !== "string") continue;
      const marker = "node_modules/";
      const at = key.lastIndexOf(marker);
      const derived = at === -1 ? "" : key.slice(at + marker.length);
      const alias = entry["name"];
      addVersion(into, typeof alias === "string" ? alias : derived, version);
    }
    return;
  }
  walkLegacyDependencies(parsed["dependencies"], into);
}

/** Extract the package name from a yarn descriptor such as `@scope/pkg@^1.0.0` or `pkg@npm:^1`. */
function yarnDescriptorName(descriptor: string): string {
  const unquoted = descriptor.trim().replace(/^["']|["']$/g, "");
  const at = unquoted.indexOf("@", 1);
  return at === -1 ? unquoted : unquoted.slice(0, at);
}

/**
 * Collect package versions from a `yarn.lock` (classic v1 and berry formats).
 *
 * @param content - Raw lock file text
 * @param into - Map to add to
 */
export function collectYarnLockVersions(content: string, into: PackageVersions): void {
  let names: string[] = [];
  for (const line of content.split(/\r?\n/)) {
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    if (!/^\s/.test(line)) {
      names = [];
      if (!line.trimEnd().endsWith(":") || line.startsWith("__metadata")) continue;
      const header = line.trimEnd().slice(0, -1);
      names = [...new Set(header.split(",").map(yarnDescriptorName).filter((n) => n.length > 0))];
      continue;
    }
    const versionMatch = /^\s+version:?\s+["']?([^"'\s]+)["']?\s*$/.exec(line);
    if (versionMatch !== null && names.length > 0) {
      const version = versionMatch[1] ?? "";
      if (!version.startsWith("0.0.0-use.local")) {
        for (const name of names) addVersion(into, name, version);
      }
      names = [];
    }
  }
}

/**
 * Collect package versions from a `pnpm-lock.yaml` (`packages:` section; v5 to v9 key styles).
 *
 * @param content - Raw lock file text
 * @param into - Map to add to
 */
export function collectPnpmLockVersions(content: string, into: PackageVersions): void {
  let inPackages = false;
  for (const line of content.split(/\r?\n/)) {
    if (/^\S/.test(line)) {
      inPackages = /^packages:\s*$/.test(line);
      continue;
    }
    if (!inPackages) continue;
    const keyMatch = /^ {2}(?:'([^']+)'|"([^"]+)"|([^\s'"][^:]*?)):\s*(?:\{\}\s*)?$/.exec(line);
    const raw = keyMatch?.[1] ?? keyMatch?.[2] ?? keyMatch?.[3];
    if (raw === undefined) continue;

    const key = raw.replace(/^\//, "").replace(/\(.*$/, "");
    // v5 keys (`name/1.2.3_peer@4`) can contain `@` in the peer suffix, so try them before the `name@version` form.
    const legacy = /^(.+)\/(\d+\.[^/_@]*)(?:_.*)?$/.exec(key);
    if (legacy !== null) {
      addVersion(into, legacy[1] ?? "", legacy[2] ?? "");
      continue;
    }
    const modern = /^(@?[^@]+)@(.+)$/.exec(key);
    if (modern !== null) {
      addVersion(into, modern[1] ?? "", modern[2] ?? "");
      continue;
    }
    const slash = key.lastIndexOf("/");
    if (slash > 0) {
      addVersion(into, key.slice(0, slash), (key.slice(slash + 1).split("_")[0]) ?? "");
    }
  }
}

/**
 * Names that resolve to more than one distinct version.
 *
 * @param versions - Collected package versions
 * @returns Duplicates sorted by name, with sorted versions
 */
export function findDuplicateVersions(versions: PackageVersions): Array<{ name: string; versions: string[] }> {
  const duplicates: Array<{ name: string; versions: string[] }> = [];
  for (const [name, set] of versions) {
    if (set.size > 1) {
      duplicates.push({ name, versions: [...set].sort((a, b) => a.localeCompare(b, "en", { numeric: true })) });
    }
  }
  return duplicates.sort((a, b) => a.name.localeCompare(b.name));
}
