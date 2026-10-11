import { randomBytes } from "node:crypto";
import { createMuraqibContent } from "./content/muraqib.js";
import { loadPackageInfo, type PackageInfo } from "./package-info.js";
import { renderPage } from "./render/page.js";

export { createMuraqibContent, DEPENDENCY_PURPOSE } from "./content/muraqib.js";
export { CHANGELOG, type ChangelogRelease } from "./content/changelog.js";
export { loadPackageInfo, parsePackageInfo, type PackageInfo } from "./package-info.js";
export { renderPage, type RenderOptions } from "./render/page.js";
export type * from "./content/types.js";

/**
 * Complete HTML for the Muraqib documentation page, ready to assign to a VS Code
 * `webview.html`. Pass the nonce your extension also puts in the webview's CSP; the page's
 * inline style and script carry it. No `vscode` dependency is involved.
 *
 * @param nonce - CSP nonce (at least 8 base64/base64url characters).
 * @param info - Package metadata; defaults to this package's own `package.json`.
 */
export function getWebviewHtml(nonce: string, info: PackageInfo = loadPackageInfo()): string {
  return renderPage(createMuraqibContent(info), { nonce });
}

/** Generate a fresh random CSP nonce for standalone previews. */
export function createNonce(): string {
  return randomBytes(16).toString("base64url");
}
