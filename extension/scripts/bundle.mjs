// Bundles the extension host and muraqib-core (with its runtime dependencies) into one CommonJS file,
// so the .vsix ships a single script instead of the core's whole dependency tree.
//
// The core is ESM and reads `import.meta.url` (to find its own package.json and to resolve optional
// peers); in a CommonJS bundle that value is rebuilt from `__filename`, which keeps both lookups working:
// `../../package.json` from `dist/host/` is the extension's own manifest.
import { build } from "esbuild";
import { resolve } from "node:path";

const extensionDir = resolve(import.meta.dirname, "..");

await build({
  absWorkingDir: extensionDir,
  entryPoints: ["src/host/extension.ts"],
  outfile: "dist/host/extension.js",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node18",
  minify: true,
  // `vscode` is provided by the host; the AI SDK and schema engines are optional peers of the core that
  // are loaded on demand, so they are not shipped (the core reports them as missing when used).
  external: ["vscode", "@google/genai", "arktype", "valibot"],
  define: { "import.meta.url": "__importMetaUrl" },
  banner: { js: 'const __importMetaUrl = require("node:url").pathToFileURL(__filename).href;' },
  logLevel: "info",
});
