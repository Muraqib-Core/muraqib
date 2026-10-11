import { readFileSync } from "node:fs";

/** The subset of `package.json` the documentation page is built from. */
export interface PackageInfo {
  name: string;
  version: string;
  license: string;
  homepage?: string;
  repositoryUrl?: string;
  bugsUrl?: string;
  nodeEngine: string;
  npmEngine?: string;
  dependencies: Record<string, string>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`package.json: "${field}" must be a non-empty string`);
  }
  return value;
}

/** `git+https://host/org/repo.git` -> `https://host/org/repo`. */
function normalizeRepositoryUrl(url: string): string {
  return url.replace(/^git\+/, "").replace(/\.git$/, "");
}

/**
 * Validate parsed `package.json` data into {@link PackageInfo}.
 * @throws Error when a required field is missing or has the wrong type.
 */
export function parsePackageInfo(raw: unknown): PackageInfo {
  if (!isRecord(raw)) throw new Error("package.json must contain a JSON object");
  const engines = isRecord(raw["engines"]) ? raw["engines"] : {};
  const repository = raw["repository"];
  const bugs = raw["bugs"];
  const deps = isRecord(raw["dependencies"]) ? raw["dependencies"] : {};

  const info: PackageInfo = {
    name: text(raw["name"], "name"),
    version: text(raw["version"], "version"),
    license: text(raw["license"], "license"),
    nodeEngine: text(engines["node"], "engines.node"),
    dependencies: Object.fromEntries(
      Object.entries(deps).flatMap(([name, range]) => (typeof range === "string" ? [[name, range]] : []))
    ),
  };
  if (typeof raw["homepage"] === "string") info.homepage = raw["homepage"];
  if (isRecord(repository) && typeof repository["url"] === "string") {
    info.repositoryUrl = normalizeRepositoryUrl(repository["url"]);
  }
  if (isRecord(bugs) && typeof bugs["url"] === "string") info.bugsUrl = bugs["url"];
  if (typeof engines["npm"] === "string") info.npmEngine = engines["npm"];
  return info;
}

/**
 * Read the package's own `package.json`. Both `src/webview` and `dist/webview` sit two levels
 * below the package root, so the same relative path works in development and when published.
 */
export function loadPackageInfo(): PackageInfo {
  const file = new URL("../../package.json", import.meta.url);
  return parsePackageInfo(JSON.parse(readFileSync(file, "utf8")) as unknown);
}
