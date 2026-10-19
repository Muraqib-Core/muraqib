import semver from "semver";

const ZERO = new semver.SemVer("0.0.0");

/**
 * Lenient semver comparison: versions are coerced to `major.minor.patch`
 * (pre-release tags are ignored) and unparsable input counts as `0.0.0`.
 *
 * @returns negative when `a < b`, positive when `a > b`, `0` when equal
 */
export function compareVersions(a: string, b: string): number {
  return (semver.coerce(a) ?? ZERO).compare(semver.coerce(b) ?? ZERO);
}
