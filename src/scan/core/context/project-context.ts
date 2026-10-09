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

export function createProjectContext(projectPath: string = process.cwd()): ProjectContext {
  let packageManager: ProjectContext["packageManager"] = "npm";

  const pkgPath = path.join(projectPath, "package.json");
  let packageJson: Record<string, unknown> = {};
  if (fs.existsSync(pkgPath)) {
    try {
      packageJson = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as Record<string, unknown>;
    } catch {
      throw new Error(`Unable to parse package.json at ${pkgPath}`);
    }
  }

  const declaredManager = typeof packageJson.packageManager === "string"
    ? packageJson.packageManager.split("@")[0]
    : undefined;
  const hasSupportedDeclaredManager =
    declaredManager === "pnpm" ||
    declaredManager === "npm" ||
    declaredManager === "yarn" ||
    declaredManager === "bun";
  if (hasSupportedDeclaredManager) {
    packageManager = declaredManager;
  }

  if (!hasSupportedDeclaredManager && fs.existsSync(path.join(projectPath, "pnpm-lock.yaml"))) {
    packageManager = "pnpm";
  } else if (!hasSupportedDeclaredManager && fs.existsSync(path.join(projectPath, "yarn.lock"))) {
    packageManager = "yarn";
  } else if (!hasSupportedDeclaredManager && fs.existsSync(path.join(projectPath, "bun.lockb"))) {
    packageManager = "bun";
  }

  let envFiles: string[] = [];
  try {
    envFiles = fs
      .readdirSync(projectPath)
      .filter((file) => file.startsWith(".env"))
      .filter((file) => file !== ".env.example" && file !== ".env.test")
      .sort();
  } catch {
    envFiles = [];
  }

  let dependencies: Record<string, string> = {};
  let devDependencies: Record<string, string> = {};
  dependencies = (packageJson.dependencies as Record<string, string> | undefined) ?? {};
  devDependencies = (packageJson.devDependencies as Record<string, string> | undefined) ?? {};

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
