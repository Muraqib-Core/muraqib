# Muraqib for VS Code

Run security, performance, dependency, Docker and configuration audits on your project from inside VS Code, and see the results where you already work: the **Problems** panel, a status bar counter, and a report that groups issues by severity and by module. The report supports Arabic and right-to-left layouts.

Muraqib is built to catch the mistakes that AI-generated code tends to leave behind: hardcoded secrets, missing `await`, environment variables that are used but never documented, risky configuration, and vulnerable dependencies.

## Get started

1. Install **Muraqib** from the Extensions view (or run `ext install muraqib-core.muraqib-vscode`).
2. Open a project folder and trust the workspace when VS Code asks.
3. Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) and run **Muraqib: Run Audit**.

The audit opens a report, fills the Problems panel with findings you can click to jump to the code, and shows a counter in the status bar. Click the status bar item to reopen the last report.

## Commands

| Command | What it does |
| --- | --- |
| `Muraqib: Run Audit` | Audits the workspace folder, opens the report, fills the Problems panel and the status bar. |
| `Muraqib: Show Documentation` | Opens the Muraqib documentation page (offline, no network). |
| `Muraqib: Show Last Report` | Re-opens the most recent report. |

A failing verdict, or an audit that could not run reliably, is shown in the report and status bar rather than as an error popup.

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `muraqib.modules` | `[]` | Only run modules whose name contains one of these strings (`security`, `memory`, `docker`, ...). Empty runs everything. |
| `muraqib.osv` | `false` | Include dependency vulnerability scanning (contacts the OSV service). |
| `muraqib.docker` | `false` | Include Docker discovery and Dockerfile analysis. |
| `muraqib.securityUrl` | `""` | `http(s)` URL of a running service to check its HTTP security headers. Empty skips the check. |
| `muraqib.failOnWarning` | `false` | Treat warnings as a failing verdict. |
| `muraqib.maxIssues` | `500` | Cap on returned issues; `0` means no limit. |

## Privacy and safety

- **Your code stays on your machine.** Audits run locally. The only network requests are the ones you turn on: `muraqib.osv` contacts the OSV vulnerability service, and `muraqib.securityUrl` contacts the URL you give it.
- **No AI service is contacted.** The AI advisory option of the Muraqib engine is deliberately not exposed in this extension.
- **It never edits your code.** The extension only reads files and reports findings.
- **Trusted, local workspaces only.** Muraqib reads project files, so it does not run in untrusted or virtual workspaces.
- The report view has a strict Content-Security-Policy (no network, no remote resources), and "open file at line" only opens existing files inside your workspace.

## Requirements

VS Code 1.85 or newer, and a local project folder.

## More

- Source, issues and the command line tool: https://github.com/Muraqib-Core/muraqib
- Changes: see the [changelog](CHANGELOG.md).
- Contributing to the extension: [DEVELOPMENT.md](https://github.com/Muraqib-Core/muraqib/blob/main/extension/DEVELOPMENT.md).

## License

ISC, see [LICENSE](LICENSE).
