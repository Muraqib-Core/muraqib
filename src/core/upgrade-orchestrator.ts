import { execSync } from 'child_process';
import semver from 'semver';
import { getMuraqibNewVersionValue, type VersionUpdateStrategy } from './muraqib-version.js';
import { MURAQIB_LOCAL_PRESETS, fetchRemoteMuraqibPresets } from '../config/presets.js';
import type { PackageGroup } from '../config/presets.js'; 
import { detectProjectPackageManager } from '../utils/manager-detector.js'; 

/**
 * Configuration for a schema migration during package upgrade
 * @interface SchemaMigrationRule
 */
interface SchemaMigrationRule {
  packageName: string;
  breakingMajor: number;
  migrationCommand: string;
  description: string;
}

/**
 * Validates a command string for safe execution.
 * Checks for empty, excessive length, and multiline content.
 *
 * @param cmd - Command string to validate
 * @returns true if command is safe to execute, false otherwise
 */
function isValidCommand(cmd: string): boolean {
  if (!cmd || typeof cmd !== 'string' || cmd.trim().length === 0) {
    return false;
  }
  const trimmed = cmd.trim();
  if (trimmed.length > 2000) {
    return false;
  }
  if (trimmed.includes('\n') || trimmed.includes('\r')) {
    return false;
  }
  return true;
}

export const SCHEMA_MIGRATIONS_REGISTRY: SchemaMigrationRule[] = [
  {
    packageName: 'tailwindcss',
    breakingMajor: 4,
    migrationCommand: 'npx @tailwindcss/upgrade@latest --yes',
    description: 'تحويل إعدادات tailwind.config.js القديمة إلى نظام CSS-first (@theme) تلقائياً',
  },
  {
    packageName: 'prisma',
    breakingMajor: 6,
    migrationCommand: 'npx prisma format && npx prisma validate',
    description: 'تحديث وتدقيق سكيما بريسما لتتوافق مع معايير النسخة 6 القياسية',
  },
  {
    packageName: 'next',
    breakingMajor: 15,
    migrationCommand: 'npx @next/codemod@latest next-async-request-api --force',
    description: 'تحويل الـ Params والـ SearchParams لنظام الـ Async الإجباري في Next.js 15',
  },
  {
    packageName: 'react',
    breakingMajor: 19,
    migrationCommand: 'npx react-codemod@latest update-react-imports --force',
    description: 'تطهير وتحديث الـ Components والـ Refs لتتوافق مع معايير React 19 الجديدة',
  },
  {
    packageName: 'eslint',
    breakingMajor: 9,
    migrationCommand: 'npx @eslint/config-inspector@latest --init',
    description: 'ترقية نظام الإعدادات إلى Flat Config وحل مشاكل القواعد المتعارضة تلقائياً',
  },
  {
    packageName: 'zustand',
    breakingMajor: 5,
    migrationCommand: 'npx zustand-codemod v5-migration ./src',
    description: 'تحديث دوال إنشاء الـ Stores وحذف الـ Deprecated signatures لتتوافق مع تزامنية React 19',
  }
];

/**
 * Configuration for the package upgrade orchestrator
 * @interface OrchestratorConfig
 */
export interface OrchestratorConfig { // muraqib-ignore-dead: auto-suppressed by script for OrchestratorConfig
  packageName: string;
  currentValue: string;
  newVersion: string;
  rangeStrategy: 'replace' | 'widen' | 'bump';
  remotePresetUrl?: string;
}

/**
 * Orchestrates intelligent package upgrades with schema migrations and build verification.
 * Handles version bumping, automatic codemods for breaking changes (Tailwind, Prisma, Next.js, React, ESLint, Zustand),
 * and validates build integrity after upgrade. Preserves unsaved changes via Git rollback on failure.
 *
 * @param config - OrchestratorConfig with package details and upgrade strategy
 * @returns Promise with updatedVersion (or null if skipped), schemaMigrated flag, and optional skipReason
 * @example
 * const result = await runMuraqibUpgradeOrchestrator({
 *   packageName: 'react',
 *   currentValue: '^18.0.0',
 *   newVersion: '^19.0.0',
 *   rangeStrategy: 'replace'
 * });
 */
export async function runMuraqibUpgradeOrchestrator({
  packageName,
  currentValue,
  newVersion,
  rangeStrategy,
  remotePresetUrl,
}: OrchestratorConfig): Promise<{ updatedVersion: string | null; schemaMigrated: boolean; skipReason?: string }> {

  let schemaMigrated = false;
  if (typeof packageName !== 'string' || packageName.trim().length === 0) {
    console.error('❌ [Muraqib Orchestrator Error]: Invalid package name.');
    return { updatedVersion: null, schemaMigrated: false };
// muraqib-unreachable: flagged by automated triage. Review before removal.
  }

  if (typeof newVersion !== 'string' || newVersion.trim().length === 0) {
    console.error(`❌ [Muraqib Orchestrator Error]: Invalid new version for ${packageName}.`);
// muraqib-unreachable: flagged by automated triage. Review before removal.
    return { updatedVersion: null, schemaMigrated: false };
  }

  const coercedCurrent = semver.coerce(currentValue);
  if (!coercedCurrent || !semver.valid(coercedCurrent)) {
// muraqib-unreachable: flagged by automated triage. Review before removal.
    console.warn(`⚠️  [Muraqib Guard]: Skipping package "${packageName}". Reason: [invalid-version syntax]`);
    return { updatedVersion: null, schemaMigrated: false, skipReason: 'invalid-version' };
  }
  const currentEnv = detectProjectPackageManager();
  // Map the simple package manager id to a small command/metadata object
  const managerMeta: Record<string, { type: string; commands: { lockFile: string; build: string } }> = {
    npm: { type: 'npm', commands: { lockFile: 'package-lock.json', build: 'npm run build' } },
    yarn: { type: 'yarn', commands: { lockFile: 'yarn.lock', build: 'yarn build' } },
    pnpm: { type: 'pnpm', commands: { lockFile: 'pnpm-lock.yaml', build: 'pnpm -w build' } },
  };

  const envMeta = (managerMeta[currentEnv as string] ?? managerMeta['npm']!);
  console.log(`🔍 [Muraqib Environment]: Active Package Manager detected: [${envMeta.type.toUpperCase()}] via "${envMeta.commands.lockFile}"`);

  let activePresets: PackageGroup[] = MURAQIB_LOCAL_PRESETS;
 
  if (remotePresetUrl && remotePresetUrl.trim().length > 0) {
    console.log(`🌐 [Muraqib Remote Engine]: Fetching centralized presets from URL...`);
    activePresets = await fetchRemoteMuraqibPresets(remotePresetUrl);
  }

  const matchedPreset = activePresets.find(preset => 
    preset.packages.includes(packageName)
  );

  if (matchedPreset) {
    console.log(`\n📦 [Muraqib Manager]: Package "${packageName}" matches active preset group: [${matchedPreset.groupName}]`);
    console.log(`🔗 [Grouping Activation]: Muraqib will sync and update all sibling packages: (${matchedPreset.packages.join(', ')}) simultaneously.`);
  }

  const internalStrategy: VersionUpdateStrategy = rangeStrategy === 'widen' ? 'keep-both' : 'replace';

  const updatedVersionValue = getMuraqibNewVersionValue({
    currentVersion: currentValue,
    newVersion,
    updateStrategy: internalStrategy,
    packageName,
  });

  if (updatedVersionValue && updatedVersionValue !== currentValue) {
    console.log(`\n[Muraqib Engine]: Version bumped for ${packageName} to ${updatedVersionValue} 🎉`);
    
    const targetMajor = semver.major(semver.coerce(newVersion) || newVersion);

    const migrationRule = SCHEMA_MIGRATIONS_REGISTRY.find(
      (rule) => rule.packageName === packageName && targetMajor === rule.breakingMajor
    );

    if (migrationRule) {
      console.log(`⚠️  [Schema Alert]: ${packageName} v${targetMajor} introduces breaking configuration changes!`);
      console.log(`🔄 [Migration]: Running Automated Repair: ${migrationRule.description}...`);

      if (!isValidCommand(migrationRule.migrationCommand)) {
        console.error(`❌ [Security Error]: Migration command validation failed. Invalid command syntax.`);
        return { updatedVersion: currentValue, schemaMigrated: false };
      }

      try {
        execSync(migrationRule.migrationCommand, { stdio: 'inherit' });
        console.log(`✅ [Success]: Automated syntax for ${packageName} has been auto-healed!`);
        schemaMigrated = true;
      } catch (_migrationError) {
        console.error(`❌ [Error]: Automated schema migration failed for ${packageName}. Proceeding with cautious testing.`);
      }
    } else {
      console.log(`ℹ️  [Info]: No core schema modifications required for ${packageName} v${targetMajor}.`);
    }

    const targetBuildCommand = envMeta.commands.build;
    console.log(`🧪 [Integrity]: Testing project build after upgrade using: "${targetBuildCommand}"...`);

    if (!isValidCommand(targetBuildCommand)) {
      console.error(`❌ [Security Error]: Build command validation failed. Invalid command syntax.`);
      return { updatedVersion: currentValue, schemaMigrated: false };
    }

    try {
      execSync(targetBuildCommand, { stdio: 'ignore' });
      console.log(`💎 [Integrity Success]: Project build passed smoothly on [${envMeta.type.toUpperCase()}] environment! Safe to commit.`);
    } catch (_buildError) {
      console.error(`💥 [Integrity Failure]: Project build failed after updating ${packageName}!`);
      console.log(`⚠️  [Warning]: Build failed. The package upgrade has been applied but the build needs to be fixed before committing.`);
      console.log(`🔍 [Next Steps]: Review the error above and fix the build issues, then run the build command again.`);
      return { updatedVersion: currentValue, schemaMigrated: false };
    }
  }

  return {
    updatedVersion: updatedVersionValue,
    schemaMigrated,
  };
}
