import * as fs from "node:fs";
import * as path from "node:path";

export type ValidationEngineName = "zod" | "valibot" | "arktype" | "custom";

/**
 * Detect validation engine.
 *
 * @param projectRoot - Project root
 * @returns Detect validation engine result
 */
export function detectValidationEngine(projectRoot: string = process.cwd()): ValidationEngineName {
  const pkgPath = path.join(projectRoot, "package.json");

  if (!fs.existsSync(pkgPath)) {
    return "custom";
  }

  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));

    const allDeps: Record<string, string> = {
      ...(pkg.dependencies ?? {}),
      ...(pkg.devDependencies ?? {}),
    };

    if ("zod" in allDeps) return "zod";
    if ("valibot" in allDeps) return "valibot";
    if ("arktype" in allDeps) return "arktype";

    return "custom";
  } catch {
    return "custom";
  }
}
