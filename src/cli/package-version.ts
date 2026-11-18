import { readFileSync } from "fs";
import { fileURLToPath } from "url";

/** Read the package version at runtime so `--version` never drifts from package.json. */
export function readPackageVersion(): string {
  try {
    const pkgPath = fileURLToPath(new URL("../../package.json", import.meta.url));
    const pkg: unknown = JSON.parse(readFileSync(pkgPath, "utf8"));
    if (typeof pkg === "object" && pkg !== null && "version" in pkg && typeof pkg.version === "string") {
      return pkg.version;
    }
  } catch {
    // fall through to the placeholder
  }
  return "unknown";
}
