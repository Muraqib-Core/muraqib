# Muraqib for VS Code: development

This file is for people working on the extension. The user-facing description (shown on the Marketplace) is [README.md](README.md).

The extension is a thin client of `muraqib-core`: it calls `runAuditForAgent` for audits and `getWebviewHtml` for the documentation page. It never edits your code.

## Security model

- The report webview has a strict Content-Security-Policy (`default-src 'none'`, nonce-only inline style and script, no network, no remote resources).
- Every dynamic string (messages, titles, paths, module and scanner names, diagnostics) goes through `escapeHtml`; the inline script is a constant that only reads `data-*` attributes.
- Every message from the webview is validated by a type guard (`parseWebviewMessage`); malformed messages are ignored.
- **Open file at line** only opens a path that (1) appears in the last report, (2) stays inside the workspace after resolving `..` and symlinks, and (3) is an existing regular file.
- The extension requires a trusted, local workspace.

## Development

The extension lives in `extension/` and has its own `package.json`, lock file, `tsconfig` and tests. It depends on the repository build of `muraqib-core` through `"muraqib-core": "file:.."` (an npm symlink to the repository root), so it always uses the audit engine in this checkout.

```bash
# 1. Build and install the core (repository root)
npm ci
npm run build

# 2. Build and test the extension
cd extension
npm install
npm run type-check
npm run lint          # reuses the root ESLint config
npm run build
npm test
```

`npm run build:core` in `extension/` rebuilds the root package. `muraqib-core` is ESM-only and the extension host loads CommonJS, so the extension reaches it with a dynamic `import()` (see `src/host/engine.ts`) and borrows its types through `src/core/types.ts`.

To try it: open the repository in VS Code and press F5 with an "Extension Development Host" launch configuration, or run `code --extensionDevelopmentPath=$PWD/extension <folder-to-audit>`.

### Layout

```
extension/
  src/core/   pure logic, no `vscode` import (unit-tested)
    messages.ts      typed postMessage protocol + type guards
    path-safety.ts   workspace containment, traversal and symlink checks
    open-request.ts  "open file at line" authorization
    report-html.ts   report renderer (CSP, escaping, RTL)
    report-assets.ts constant CSS / JS for the webview
    diagnostics.ts   issue -> Problems panel mapping
    status.ts        status bar text
    settings.ts      settings -> engine options
    session.ts       audit orchestration behind injected ports
  src/host/   thin VS Code adapter (not unit-tested; keep it small)
    extension.ts     commands, panels, status bar, DiagnosticCollection
    engine.ts        lazy dynamic import of muraqib-core
  tests/      Vitest specs, including XSS and path-traversal cases
```

## Packaging and publishing

`npm run package` builds the core and the extension and writes `muraqib-vscode-<version>.vsix`. `scripts/bundle.mjs` bundles the extension host together with `muraqib-core` and its runtime dependencies into one CommonJS file (`dist/host/extension.js`, built with esbuild for `node18`), and `scripts/package.mjs` packages it from a clean staging directory, so the `.vsix` runs on a machine that has nothing but VS Code. The AI SDK and schema engines (`@google/genai`, `arktype`, `valibot`) are optional peers of the core and are not shipped.

```bash
cd extension
npm run package
code --install-extension muraqib-vscode-0.1.0.vsix   # smoke-test in a clean profile
```

Releases are published by `.github/workflows/extension-release.yml` when a tag `extension-v<version>` is pushed (the version must match `extension/package.json`):

```bash
# bump "version" in extension/package.json and add an entry to extension/CHANGELOG.md, merge, then:
git tag extension-v0.1.0 && git push origin extension-v0.1.0
```

One-time setup:

1. Create the `muraqib-core` publisher at https://marketplace.visualstudio.com/manage (the `publisher` field must match).
2. Create an Azure DevOps personal access token (organization: all accessible organizations, scope **Marketplace > Manage**) and save it as the repository secret `VSCE_PAT`.
3. Optional, for Open VSX (VSCodium, Cursor, ...): create the namespace with `npx ovsx create-namespace muraqib-core -p <token>`, then save the token as the repository secret `OVSX_PAT`. Without it the Open VSX step is skipped.

The Marketplace page shows `README.md` (user-facing). This file is developer documentation and is not shipped in the `.vsix`.

## Runtime compatibility

The bundle targets `node18` because VS Code 1.85 runs extensions on Node 18, while `muraqib-core` declares `node >=20.12` for its CLI. Before a release, smoke-test the packaged extension on the oldest supported VS Code (1.85) and check that no Node 20-only API is reached from `runAuditForAgent` (the CLI-only `util.styleText` in `src/scan/cli/resolve-workflow.ts` is the known Node 20.12+ API in the bundle).

## License

ISC, see [LICENSE](LICENSE) (identical to the repository root [LICENSE](../LICENSE)).
