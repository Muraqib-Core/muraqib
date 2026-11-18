// Builds the .vsix from a clean staging directory that holds just what the extension ships.
//
// `dist/host/extension.js` already contains muraqib-core and its dependencies (see bundle.mjs), so the
// shipped manifest has no dependencies and nothing is installed into the staging directory.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";

const extensionDir = resolve(import.meta.dirname, "..");

function run(command, args, cwd) {
  return execFileSync(command, args, {
    cwd,
    shell: process.platform === "win32", // the vsce bin is a .cmd shim on Windows
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
}

const pkg = JSON.parse(readFileSync(join(extensionDir, "package.json"), "utf8"));
const stage = mkdtempSync(join(tmpdir(), "muraqib-vsix-"));

try {
  const manifest = { ...pkg };
  delete manifest.devDependencies;
  delete manifest.scripts;
  writeFileSync(join(stage, "package.json"), JSON.stringify(manifest, null, 2));

  for (const entry of ["README.md", "LICENSE", "CHANGELOG.md", ".vscodeignore", "images", "dist"]) {
    if (existsSync(join(extensionDir, entry))) cpSync(join(extensionDir, entry), join(stage, entry), { recursive: true });
  }

  const vsix = join(extensionDir, `${pkg.name}-${pkg.version}.vsix`);
  const vsce = join(extensionDir, "node_modules", ".bin", "vsce");
  run(vsce, ["package", "--no-dependencies", "--out", vsix], stage);
  process.stdout.write(`Packaged ${vsix}\n`);
} finally {
  rmSync(stage, { recursive: true, force: true });
}
