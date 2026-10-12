import { warn } from '../shared/logger.js';

export interface PackageGroup {
  groupName: string;
  packages: string[];
}
export const MURAQIB_LOCAL_PRESETS: PackageGroup[] = [
  {
    groupName: 'react-core-suite',
    packages: [
      'react', 
      'react-dom', 
      'react-server-dom-webpack', 
      '@types/react', 
      '@types/react-dom'
    ]
  },
  {
    groupName: 'tailwindcss-v4-stack',
    packages: [
      'tailwindcss', 
      '@tailwindcss/vite', 
      '@tailwindcss/postcss', 
      '@tailwindcss/upgrade'
    ]
  },
  {
    groupName: 'prisma-orm-ecosystem',
    packages: [
      'prisma', 
      '@client/prisma', 
      '@prisma/client'
    ]
  },
  {
    groupName: 'testing-library-react',
    packages: [
      '@testing-library/react',
      '@testing-library/dom',
      '@testing-library/user-event'
    ]
  }
];

const REMOTE_PRESET_TIMEOUT_MS = 10_000;
const MAX_REMOTE_GROUPS = 200;
const MAX_PACKAGES_PER_GROUP = 200;
const PACKAGE_NAME_PATTERN = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/;

function isPackageGroup(value: unknown): value is PackageGroup {
  if (typeof value !== 'object' || value === null) return false;
  const { groupName, packages } = value as Record<string, unknown>;
  return (
    typeof groupName === 'string' &&
    groupName.trim().length > 0 &&
    groupName.length <= 100 &&
    Array.isArray(packages) &&
    packages.length > 0 &&
    packages.length <= MAX_PACKAGES_PER_GROUP &&
    packages.every((name) => typeof name === 'string' && name.length <= 214 && PACKAGE_NAME_PATTERN.test(name))
  );
}

/**
 * Fetches shared preset groups from a remote JSON endpoint.
 * Only `https:` URLs are accepted and the payload must be an array of `{ groupName, packages }`
 * with valid npm package names; anything else falls back to the local presets.
 *
 * @param url - HTTPS URL returning the preset groups as JSON
 * @returns The validated remote groups, or the local presets when the fetch or validation fails
 */
export async function fetchRemoteMuraqibPresets(url: string): Promise<PackageGroup[]> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    warn('⚠️  [Muraqib Remote Engine]: Invalid presets URL. Local core active.');
    return MURAQIB_LOCAL_PRESETS;
  }
  if (parsedUrl.protocol !== 'https:') {
    warn('⚠️  [Muraqib Remote Engine]: Remote presets require an HTTPS URL. Local core active.');
    return MURAQIB_LOCAL_PRESETS;
  }

  try {
    const response = await fetch(parsedUrl, { signal: AbortSignal.timeout(REMOTE_PRESET_TIMEOUT_MS) });
    if (!response.ok) {
      warn(`⚠️  [Muraqib Remote Engine]: Failed to fetch presets from server (Status: ${response.status}). Falling back to local configuration.`);
      return MURAQIB_LOCAL_PRESETS;
    }
    const remoteData: unknown = await response.json();
    if (Array.isArray(remoteData) && remoteData.length <= MAX_REMOTE_GROUPS && remoteData.every(isPackageGroup)) {
      return remoteData;
    }
    warn('⚠️  [Muraqib Remote Engine]: Remote presets failed schema validation. Local core active.');
    return MURAQIB_LOCAL_PRESETS;
  } catch {
    warn('⚠️  [Muraqib Remote Engine]: Network connection error while syncing remote presets. Local core active.');
    return MURAQIB_LOCAL_PRESETS;
  }
}
