# Muraqib for VS Code

Run the Muraqib audit engine (security, performance, dependency, Docker and configuration checks) from inside VS Code. Results appear in the **Problems** panel, in a status bar counter, and in a report view that groups issues by severity and by module, with scanner coverage and diagnostics. The report supports Arabic and right-to-left layouts.

The extension is a thin client of `muraqib-core`: it calls `runAuditForAgent` for audits and `getWebviewHtml` for the documentation page. It never edits your code.

## Commands

| Command | What it does |
| --- | --- |
| `Muraqib: Run Audit` | Audits the workspace folder, opens the report, fills the Problems panel and the status bar. |
| `Muraqib: Show Documentation` | Opens the Muraqib documentation page (offline, no network). |
| `Muraqib: Show Last Report` | Re-opens the most recent report (also what the status bar item does on click). |

Findings are data, not crashes: a failing verdict (exit code 1) or an audit that could not run reliably (`ok: false`, exit code 3) is shown in the report and status bar. The extension never sets `process.exitCode`.

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `muraqib.modules` | `[]` | Only run modules whose name contains one of these strings (`security`, `memory`, `docker`, ...). |
| `muraqib.osv` | `false` | Include OSV dependency vulnerability scanning (contacts the OSV service). |
| `muraqib.docker` | `false` | Include Docker discovery and Dockerfile analysis. |
| `muraqib.securityUrl` | `""` | `http(s)` URL of a running service for HTTP security-header checks. Other schemes are ignored. |
| `muraqib.failOnWarning` | `false` | Treat warnings as a failing verdict. |
| `muraqib.maxIssues` | `500` | Cap on returned issues; `0` means no limit. |

The AI advisory option is deliberately not exposed, because it would send project data to an external service.

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

## Publishing to the Marketplace (not done yet)

1. Publish `muraqib-core` to npm, then change the dependency in `extension/package.json` from `file:..` to its version range and re-run `npm install` (the `file:` link cannot be packaged).
2. Set a real `publisher`, add a 128x128 PNG `icon`, remove `"private": true`, and bump `version`.
3. `npm install -g @vscode/vsce`, then `vsce login <publisher>` with a Marketplace personal access token.
4. `npm run build && vsce package` (this bundles `node_modules/muraqib-core` per `.vscodeignore`; consider bundling with esbuild to shrink the package), install the `.vsix` locally to smoke-test, then `vsce publish`.
5. Optionally publish to Open VSX with `ovsx publish`.

## License

ISC, see [LICENSE](LICENSE) (identical to the repository root [LICENSE](../LICENSE)).
