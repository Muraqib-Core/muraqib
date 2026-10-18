// Builds the .vsix from a clean staging directory.
//
// During development `muraqib-core` is an npm symlink to the repository root, and vsce does not follow
// symlinks, so packaging in place would leave the audit engine (and its dependencies) out of the .vsix.
// Instead the core is packed into a tarball and installed, production dependencies only, into a staging
// directory that holds just what the extension ships; vsce then packages that directory.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import process from "node:process";

const extensionDir = resolve(import.meta.dirname, "..");
const coreDir = resolve(extensionDir, "..");
const shell = process.platform === "win32"; // npm is a .cmd shim on Windows

function run(command, args, cwd) {
  return execFileSync(command, args, { cwd, shell, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
}

const pkg = JSON.parse(readFileSync(join(extensionDir, "package.json"), "utf8"));
const stage = mkdtempSync(join(tmpdir(), "muraqib-vsix-"));

try {
  const tarball = run("npm", ["pack", "--silent", "--pack-destination", stage], coreDir).trim().split("\n").pop();

  // The shipped manifest: same as the extension's, but the core comes from the tarball and nothing is dev-only.
  const manifest = { ...pkg };
  delete manifest.devDependencies;
  delete manifest.scripts;
  manifest.dependencies = { "muraqib-core": `file:${basename(tarball)}` };
  writeFileSync(join(stage, "package.json"), JSON.stringify(manifest, null, 2));

  for (const entry of ["README.md", "LICENSE", "CHANGELOG.md", ".vscodeignore", "images", "dist"]) {
    if (existsSync(join(extensionDir, entry))) cpSync(join(extensionDir, entry), join(stage, entry), { recursive: true });
  }

  run("npm", ["install", "--omit=dev", "--no-audit", "--no-fund", "--no-package-lock"], stage);

  const vsix = join(extensionDir, `${pkg.name}-${pkg.version}.vsix`);
  const vsce = join(extensionDir, "node_modules", ".bin", "vsce");
  run(vsce, ["package", "--out", vsix], stage);
  process.stdout.write(`Packaged ${vsix}\n`);
} finally {
  rmSync(stage, { recursive: true, force: true });
}
