import { existsSync } from 'node:fs';
import { join } from 'node:path';

export type PackageManager = 'npm' | 'yarn' | 'pnpm'; // muraqib-ignore-dead: auto-suppressed by script for PackageManager
export function detectProjectPackageManager(
  basePath: string = process.cwd()
): PackageManager {
  
  const lockFiles: Record<string, PackageManager> = {
    'pnpm-lock.yaml': 'pnpm',
    'yarn.lock': 'yarn',
    'package-lock.json': 'npm',
  };

  for (const [file, manager] of Object.entries(lockFiles)) {
    if (existsSync(join(basePath, file))) {
    return manager;
    }
  }

  return 'npm';
}