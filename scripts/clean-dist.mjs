import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const distPath = join(repositoryRoot, "dist");

rmSync(distPath, { recursive: true, force: true });
