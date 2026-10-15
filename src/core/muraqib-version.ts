import semver from 'semver';

export type VersionUpdateStrategy = 'replace' | 'keep-both';

export interface MuraqibVersionConfig { // muraqib-ignore-dead: auto-suppressed by script for MuraqibVersionConfig
  currentVersion: string;
  newVersion: string;
  updateStrategy: VersionUpdateStrategy;
  packageName?: string;
}

/** Range operators that are preserved when a version is replaced (`x` and `*` are wildcards, not operators). */
const RANGE_PREFIX = /^(\^|~|>=|<=|>|<|=)/;

/**
 * Computes the version spec that should replace `currentVersion`.
 *
 * Rules:
 * - Non-string input, a prerelease `newVersion`, or a `newVersion` that is not a valid/coercible
 *   semver (dist-tags such as `latest`, `next`, `*`) never change anything: the current value is returned.
 * - A wildcard or otherwise non-coercible current spec (`*`, `latest`) is returned unchanged.
 * - If the current spec already resolves to a version greater than or equal to `newVersion`, it is kept.
 * - Only the operators `^ ~ = >= <= > <` are kept as prefix. For compound or union ranges
 *   (`>=1.0.0 <2`, `^1 || ^2`, `1.0.0 - 2.0.0`) only the FIRST comparator's prefix is kept, so
 *   `replace` turns `>=1.0.0 <2` into `>=2.0.0` (the upper bound is dropped on purpose).
 * - `replace` returns `<prefix><newVersion>`; `keep-both` returns `<current> || <prefix><newVersion>`.
 *
 * @param config - Current spec, new version, strategy and optional package name
 * @returns The new version spec, or the current one when no change applies
 */
export function getMuraqibNewVersionValue({
  currentVersion,
  newVersion,
  updateStrategy,
  packageName: _packageName,
}: MuraqibVersionConfig): string | null {

  if (typeof currentVersion !== 'string' || typeof newVersion !== 'string') {
    return currentVersion;
  }

  const cleanCurrent = currentVersion.trim();
  const cleanNew = newVersion.trim();
  const parsedNew = semver.parse(cleanNew);

  if (parsedNew && parsedNew.prerelease.length > 0) {
    return cleanCurrent;
  }

  const coercedNew = semver.coerce(cleanNew);
  if (!coercedNew) {
    return cleanCurrent;
  }

  const coercedCurrent = semver.coerce(cleanCurrent);
  if (!coercedCurrent) {
    return cleanCurrent;
  }

  if (semver.gte(coercedCurrent, coercedNew)) {
    return cleanCurrent;
  }

  const firstComparator = cleanCurrent.split(/\s+|\|\|/).find((part) => part.length > 0) ?? '';
  const prefix = RANGE_PREFIX.exec(firstComparator)?.[0] ?? '';

  const pureNewVersion = semver.clean(cleanNew) ?? coercedNew.version;
  const formattedNewVersion = `${prefix}${pureNewVersion}`;

  switch (updateStrategy) {
    case 'replace':
      return formattedNewVersion;

    case 'keep-both':
      return `${cleanCurrent} || ${formattedNewVersion}`;

    default: {
      const exhaustive: never = updateStrategy;
      void exhaustive;
      return cleanCurrent;
    }
  }
}
