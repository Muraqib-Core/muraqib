import { createRequire } from "node:module";

/**
 * Thrown when an optional peer dependency is needed but not installed.
 * The message is actionable: it names the package and the feature that needs it.
 */
export class MissingOptionalDependencyError extends Error {
  readonly packageName: string;
  readonly feature: string;

  constructor(packageName: string, feature: string) {
    super(
      `Missing optional dependency "${packageName}": install ${packageName} to use ${feature} ` +
        `(npm install ${packageName})`
    );
    this.name = "MissingOptionalDependencyError";
    this.packageName = packageName;
    this.feature = feature;
  }
}

function isModuleNotFound(error: unknown, packageName: string): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = (error as { code?: unknown }).code;
  if (code !== "ERR_MODULE_NOT_FOUND" && code !== "MODULE_NOT_FOUND") return false;
  const message = String((error as { message?: unknown }).message ?? "");
  return message.includes(packageName);
}

/**
 * Lazily import an optional peer dependency.
 * @param packageName npm package name, e.g. "zod"
 * @param feature human readable feature, e.g. "engine 'zod'"
 * @throws MissingOptionalDependencyError when the package is not installed
 */
export async function loadOptionalDependency<T>(packageName: string, feature: string): Promise<T> {
  try {
    return (await import(packageName)) as T;
  } catch (error) {
    if (isModuleNotFound(error, packageName)) {
      throw new MissingOptionalDependencyError(packageName, feature);
    }
    throw error;
  }
}

/**
 * Synchronous variant for APIs that must stay synchronous (public engine wrappers).
 * Resolves the package from the consumer's install via CommonJS resolution.
 * @throws MissingOptionalDependencyError when the package is not installed
 */
export function requireOptionalDependency<T>(packageName: string, feature: string): T {
  try {
    return createRequire(import.meta.url)(packageName) as T;
  } catch (error) {
    if (isModuleNotFound(error, packageName)) {
      throw new MissingOptionalDependencyError(packageName, feature);
    }
    throw error;
  }
}
