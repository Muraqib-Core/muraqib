import * as fs from "node:fs";
import * as path from "node:path";

export interface ProjectContext {
  projectPath: string;
  packageManager: "pnpm" | "npm" | "yarn" | "bun";
  nodeVersion: string;
  files: string[];
  envFiles: string[];
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  dockerfiles: string[];
  composeFiles: string[];
  dockerignoreFiles: string[];
}

import { discoverDockerFiles } from "./docker-discovery.js";
import { detectProjectPackageManager } from "../../../utils/manager-detector.js";

/**
 * Create project context.
 *
 * @param projectPath - Project path
 * @returns Create project context result
 */
export function createProjectContext(projectPath: string = process.cwd()): ProjectContext {
  const pkgPath = path.join(projectPath, "package.json");
  let packageJson: Record<string, unknown> = {};
  if (fs.existsSync(pkgPath)) {
    try {
      packageJson = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as Record<string, unknown>;
    } catch {
      throw new Error(`Unable to parse package.json at ${pkgPath}`);
    }
  }

  const packageManager = detectProjectPackageManager(projectPath);

  let envFiles: string[];
  try {
    envFiles = fs
      .readdirSync(projectPath)
      .filter((file) => file.startsWith(".env"))
      .filter((file) => file !== ".env.example" && file !== ".env.test")
      .sort();
  } catch {
    envFiles = [];
  }

  const dependencies = (packageJson.dependencies as Record<string, string> | undefined) ?? {};
  const devDependencies = (packageJson.devDependencies as Record<string, string> | undefined) ?? {};

  const { dockerfiles, composeFiles, dockerignoreFiles } = discoverDockerFiles(projectPath);

  return {
    projectPath,
    packageManager,
    nodeVersion: process.version,
    files: envFiles,
    envFiles,
    dependencies,
    devDependencies,
    dockerfiles,
    composeFiles,
    dockerignoreFiles,
  };
}
