import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readJsonFile } from '../shared/fs-safe.js';

export type PackageManager = 'npm' | 'yarn' | 'pnpm' | 'bun';

const SUPPORTED_MANAGERS: readonly PackageManager[] = ['npm', 'yarn', 'pnpm', 'bun'];

/** Lockfiles in priority order; the first one present decides. */
const LOCK_FILES: ReadonlyArray<readonly [string, PackageManager]> = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['bun.lockb', 'bun'],
  ['bun.lock', 'bun'],
  ['package-lock.json', 'npm'],
];

/** The manager named by the `packageManager` field of package.json (e.g. `pnpm@9.1.0`), if any. */
function readDeclaredManager(basePath: string): PackageManager | undefined {
  const pkg = readJsonFile(join(basePath, 'package.json'));
  const declared = typeof pkg === 'object' && pkg !== null ? (pkg as { packageManager?: unknown }).packageManager : undefined;
  const name = typeof declared === 'string' ? declared.split('@')[0] : undefined;
  return SUPPORTED_MANAGERS.find((manager) => manager === name);
}

/**
 * Detect the package manager a project uses: the `packageManager` field of package.json wins,
 * then the lockfile that is present, and `npm` when there is neither.
 *
 * @param basePath - Project root
 * @returns The detected package manager
 */
export function detectProjectPackageManager(basePath: string = process.cwd()): PackageManager {
  const declared = readDeclaredManager(basePath);
  if (declared) return declared;

  for (const [file, manager] of LOCK_FILES) {
    if (existsSync(join(basePath, file))) return manager;
  }
  return 'npm';
}
