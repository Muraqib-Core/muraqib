/**
 * Writes the static documentation page to dist/webview/index.html.
 * Runs after `tsc`, so it imports the compiled module. Open the file directly in a browser.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createNonce, getWebviewHtml } from "../dist/webview/index.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outFile = join(root, "dist", "webview", "index.html");

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, getWebviewHtml(createNonce()), "utf8");
process.stdout.write(`${outFile}\n`);
