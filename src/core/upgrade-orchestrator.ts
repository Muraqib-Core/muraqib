import { execFile } from 'child_process';
import semver from 'semver';
import { log, error as logError, warn as logWarn } from '../shared/logger.js';
import { getMuraqibNewVersionValue, type VersionUpdateStrategy } from './muraqib-version.js';
import { MURAQIB_LOCAL_PRESETS, fetchRemoteMuraqibPresets } from '../config/presets.js';
import type { PackageGroup } from '../config/presets.js';
import { detectProjectPackageManager } from '../utils/manager-detector.js';

/** A single shell-less process invocation. */
export interface MigrationStep {
  command: string;
  args: string[];
}

/**
 * Configuration for a schema migration during package upgrade
 * @interface SchemaMigrationRule
 */
interface SchemaMigrationRule {
  packageName: string;
  breakingMajor: number;
  /** Human-readable command line, kept for display and compatibility. Not executed through a shell. */
  migrationCommand: string;
  /** First executable of `steps` (convenience for consumers that only support a single command). */
  command: string;
  /** Arguments of the first step of `steps`. */
  args: string[];
  /** Ordered invocations that are actually run (each via execFile, no shell). */
  steps: MigrationStep[];
  description: string;
}

function rule(
  packageName: string,
  breakingMajor: number,
  migrationCommand: string,
  steps: MigrationStep[],
  description: string,
): SchemaMigrationRule {
  const first = steps[0] ?? { command: '', args: [] };
  return { packageName, breakingMajor, migrationCommand, command: first.command, args: first.args, steps, description };
}

const MIGRATION_TIMEOUT_MS = 10 * 60 * 1000;
const BUILD_TIMEOUT_MS = 10 * 60 * 1000;
const OUTPUT_TAIL_LINES = 20;

interface CommandOutcome {
  ok: boolean;
  output: string;
}

/**
 * Runs a process without a shell and without blocking the event loop.
 * On win32 the package-manager shims are `.cmd` files, which Node can only launch through a shell;
 * the arguments are static strings defined in this module, never user input.
 */
function runCommand(step: MigrationStep, cwd: string, timeout: number): Promise<CommandOutcome> {
  const isWin = process.platform === 'win32';
  const command = isWin ? `${step.command}.cmd` : step.command;
  return new Promise<CommandOutcome>((resolve) => {
    execFile(
      command,
      step.args,
      { cwd, timeout, maxBuffer: 10 * 1024 * 1024, shell: isWin, windowsHide: true },
      (err, stdout, stderr) => {
        const output = `${String(stdout ?? '')}${String(stderr ?? '')}`;
        resolve({ ok: err === null || err === undefined, output });
      },
    );
  });
}

function tailLines(text: string, count: number): string {
  return text.split(/\r?\n/).filter((line) => line.trim().length > 0).slice(-count).join('\n');
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

/**
 * Known breaking-major schema migrations.
 *
 * Supply-chain note: the codemods are fetched with `npx <pkg>@latest`, i.e. unpinned code from the
 * npm registry is executed in the project directory. Pinning is not possible because the codemod
 * must track the target major; callers that need to avoid this can pass `runMigrations: false`.
 */
export const SCHEMA_MIGRATIONS_REGISTRY: SchemaMigrationRule[] = [
  rule(
    'tailwindcss',
    4,
    'npx @tailwindcss/upgrade@latest --yes',
    [{ command: 'npx', args: ['@tailwindcss/upgrade@latest', '--yes'] }],
    'تحويل إعدادات tailwind.config.js القديمة إلى نظام CSS-first (@theme) تلقائياً',
  ),
  rule(
    'prisma',
    6,
    'npx prisma format && npx prisma validate',
    [
      { command: 'npx', args: ['prisma', 'format'] },
      { command: 'npx', args: ['prisma', 'validate'] },
    ],
    'تحديث وتدقيق سكيما بريسما لتتوافق مع معايير النسخة 6 القياسية',
  ),
  rule(
    'next',
    15,
    'npx @next/codemod@latest next-async-request-api --force',
    [{ command: 'npx', args: ['@next/codemod@latest', 'next-async-request-api', '--force'] }],
    'تحويل الـ Params والـ SearchParams لنظام الـ Async الإجباري في Next.js 15',
  ),
  rule(
    'react',
    19,
    'npx react-codemod@latest update-react-imports --force',
    [{ command: 'npx', args: ['react-codemod@latest', 'update-react-imports', '--force'] }],
    'تطهير وتحديث الـ Components والـ Refs لتتوافق مع معايير React 19 الجديدة',
  ),
  rule(
    'eslint',
    9,
    'npx @eslint/config-inspector@latest --init',
    [{ command: 'npx', args: ['@eslint/config-inspector@latest', '--init'] }],
    'ترقية نظام الإعدادات إلى Flat Config وحل مشاكل القواعد المتعارضة تلقائياً',
  ),
  rule(
    'zustand',
    5,
    'npx zustand-codemod v5-migration ./src',
    [{ command: 'npx', args: ['zustand-codemod', 'v5-migration', './src'] }],
    'تحديث دوال إنشاء الـ Stores وحذف الـ Deprecated signatures لتتوافق مع تزامنية React 19',
  ),
];

type ManagerId = 'npm' | 'yarn' | 'pnpm';

interface ManagerMeta {
  type: ManagerId;
  commands: { lockFile: string; build: string; buildStep: MigrationStep };
}

const MANAGER_META: Record<ManagerId, ManagerMeta> = {
  npm: { type: 'npm', commands: { lockFile: 'package-lock.json', build: 'npm run build', buildStep: { command: 'npm', args: ['run', 'build'] } } },
  yarn: { type: 'yarn', commands: { lockFile: 'yarn.lock', build: 'yarn build', buildStep: { command: 'yarn', args: ['build'] } } },
  pnpm: { type: 'pnpm', commands: { lockFile: 'pnpm-lock.yaml', build: 'pnpm -w build', buildStep: { command: 'pnpm', args: ['-w', 'build'] } } },
};

function isManagerId(value: string): value is ManagerId {
  return value === 'npm' || value === 'yarn' || value === 'pnpm';
}

/**
 * Configuration for the package upgrade orchestrator
 * @interface OrchestratorConfig
 */
export interface OrchestratorConfig { // muraqib-ignore-dead: auto-suppressed by script for OrchestratorConfig
  packageName: string;
  currentValue: string;
  newVersion: string;
  /**
   * `replace` and `bump` both rewrite the spec to the new version while keeping the current range
   * operator (`bump` is handled explicitly and behaves like `replace`); `widen` keeps the current
   * spec and appends the new one (`<current> || <new>`).
   */
  rangeStrategy: 'replace' | 'widen' | 'bump';
  remotePresetUrl?: string;
  /** Project directory in which detection, migrations and the build verification run. Defaults to the process cwd. */
  cwd?: string;
  /** Run the breaking-major migration codemods (defaults to true). Set to false to skip executing remote codemods. */
  runMigrations?: boolean;
}

function toVersionStrategy(rangeStrategy: OrchestratorConfig['rangeStrategy']): VersionUpdateStrategy {
  switch (rangeStrategy) {
    case 'widen':
      return 'keep-both';
    case 'replace':
    case 'bump':
      return 'replace';
    default: {
      const exhaustive: never = rangeStrategy;
      void exhaustive;
      return 'replace';
    }
  }
}

/**
 * Computes the new version spec for a package, runs the matching breaking-major migration codemod
 * (Tailwind, Prisma, Next.js, React, ESLint, Zustand) and verifies that the project still builds.
 *
 * This function does NOT write package.json, does NOT install the new version and does NOT roll
 * anything back: the caller owns applying the returned `updatedVersion`. The build check runs against
 * the project as it currently is on disk.
 *
 * Codemods run via `npx <package>@latest` without a shell, with a timeout, in `cwd`. This executes
 * unpinned code from the npm registry (supply-chain risk); pass `runMigrations: false` to skip them.
 *
 * Never throws for malformed versions: an unparseable `newVersion` (e.g. `latest`, `next`) yields
 * `{ updatedVersion: null, schemaMigrated: false, skipReason: 'invalid-new-version' }`.
 * If the build fails, the current value is returned unchanged and the tail of the build output is logged.
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
  cwd = process.cwd(),
  runMigrations = true,
}: OrchestratorConfig): Promise<{ updatedVersion: string | null; schemaMigrated: boolean; skipReason?: string }> {

  let schemaMigrated = false;
  if (typeof packageName !== 'string' || packageName.trim().length === 0) {
    logError('❌ [Muraqib Orchestrator Error]: Invalid package name.');
    return { updatedVersion: null, schemaMigrated: false };
  }

  if (typeof newVersion !== 'string' || newVersion.trim().length === 0) {
    logError(`❌ [Muraqib Orchestrator Error]: Invalid new version for ${packageName}.`);
    return { updatedVersion: null, schemaMigrated: false };
  }

  const coercedNew = semver.coerce(newVersion);
  if (!coercedNew) {
    logWarn(`⚠️  [Muraqib Guard]: Skipping package "${packageName}". Reason: [invalid-new-version] "${newVersion}" is not a version number.`);
    return { updatedVersion: null, schemaMigrated: false, skipReason: 'invalid-new-version' };
  }

  const coercedCurrent = semver.coerce(currentValue);
  if (!coercedCurrent || !semver.valid(coercedCurrent)) {
    logWarn(`⚠️  [Muraqib Guard]: Skipping package "${packageName}". Reason: [invalid-version syntax]`);
    return { updatedVersion: null, schemaMigrated: false, skipReason: 'invalid-version' };
  }
  const detected = String(detectProjectPackageManager(cwd));
  const envMeta = MANAGER_META[isManagerId(detected) ? detected : 'npm'];
  log(`🔍 [Muraqib Environment]: Active Package Manager detected: [${envMeta.type.toUpperCase()}] via "${envMeta.commands.lockFile}"`);

  let activePresets: PackageGroup[] = MURAQIB_LOCAL_PRESETS;

  if (remotePresetUrl && remotePresetUrl.trim().length > 0) {
    log(`🌐 [Muraqib Remote Engine]: Fetching centralized presets from URL...`);
    activePresets = await fetchRemoteMuraqibPresets(remotePresetUrl);
  }

  const matchedPreset = activePresets.find(preset =>
    preset.packages.includes(packageName)
  );

  if (matchedPreset) {
    log(`\n📦 [Muraqib Manager]: Package "${packageName}" matches active preset group: [${matchedPreset.groupName}]`);
    log(`🔗 [Grouping Activation]: Muraqib will sync and update all sibling packages: (${matchedPreset.packages.join(', ')}) simultaneously.`);
  }

  const updatedVersionValue = getMuraqibNewVersionValue({
    currentVersion: currentValue,
    newVersion,
    updateStrategy: toVersionStrategy(rangeStrategy),
    packageName,
  });

  if (updatedVersionValue && updatedVersionValue !== currentValue) {
    log(`\n[Muraqib Engine]: Version bumped for ${packageName} to ${updatedVersionValue} 🎉`);

    const targetMajor = semver.major(coercedNew);

    const migrationRule = SCHEMA_MIGRATIONS_REGISTRY.find(
      (r) => r.packageName === packageName && targetMajor === r.breakingMajor
    );

    if (migrationRule && !runMigrations) {
      log(`ℹ️  [Info]: Migration for ${packageName} v${targetMajor} skipped (runMigrations is disabled): ${migrationRule.migrationCommand}`);
    } else if (migrationRule) {
      log(`⚠️  [Schema Alert]: ${packageName} v${targetMajor} introduces breaking configuration changes!`);
      log(`🔄 [Migration]: Running Automated Repair: ${migrationRule.description}...`);

      if (!isValidCommand(migrationRule.migrationCommand)) {
        logError(`❌ [Security Error]: Migration command validation failed. Invalid command syntax.`);
        return { updatedVersion: currentValue, schemaMigrated: false };
      }

      let migrationOk = true;
      for (const step of migrationRule.steps) {
        const outcome = await runCommand(step, cwd, MIGRATION_TIMEOUT_MS);
        if (!outcome.ok) {
          migrationOk = false;
          const tail = tailLines(outcome.output, OUTPUT_TAIL_LINES);
          logError(`❌ [Error]: Automated schema migration failed for ${packageName} at "${step.command} ${step.args.join(' ')}". Proceeding with cautious testing.${tail ? `\n${tail}` : ''}`);
          break;
        }
      }
      if (migrationOk) {
        log(`✅ [Success]: Automated syntax for ${packageName} has been auto-healed!`);
        schemaMigrated = true;
      }
    } else {
      log(`ℹ️  [Info]: No core schema modifications required for ${packageName} v${targetMajor}.`);
    }

    const targetBuildCommand = envMeta.commands.build;
    log(`🧪 [Integrity]: Testing project build after upgrade using: "${targetBuildCommand}"...`);

    if (!isValidCommand(targetBuildCommand)) {
      logError(`❌ [Security Error]: Build command validation failed. Invalid command syntax.`);
      return { updatedVersion: currentValue, schemaMigrated: false };
    }

    const build = await runCommand(envMeta.commands.buildStep, cwd, BUILD_TIMEOUT_MS);
    if (build.ok) {
      log(`💎 [Integrity Success]: Project build passed smoothly on [${envMeta.type.toUpperCase()}] environment! Safe to commit.`);
    } else {
      const tail = tailLines(build.output, OUTPUT_TAIL_LINES);
      logError(`💥 [Integrity Failure]: Project build failed after updating ${packageName}!${tail ? `\n${tail}` : ''}`);
      log(`⚠️  [Warning]: Build failed. The current version "${currentValue}" is returned unchanged; Muraqib did not modify package.json.`);
      log(`🔍 [Next Steps]: Fix the build errors shown above, then run "${targetBuildCommand}" again.`);
      return { updatedVersion: currentValue, schemaMigrated: false };
    }
  }

  return {
    updatedVersion: updatedVersionValue,
    schemaMigrated,
  };
}
