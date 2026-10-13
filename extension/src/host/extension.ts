import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import * as vscode from "vscode";
import type { DiagnosticLevel, DiagnosticSpec } from "../core/diagnostics.js";
import { parseWebviewMessage, type HostToWebviewMessage } from "../core/messages.js";
import { resolveOpenRequest } from "../core/open-request.js";
import type { PathIo } from "../core/path-safety.js";
import { renderPlaceholderHtml, renderReportHtml } from "../core/report-html.js";
import { AuditSession } from "../core/session.js";
import { toAuditOptions } from "../core/settings.js";
import { formatStatus, type StatusState } from "../core/status.js";
import { lazyEngine } from "./engine.js";

const SOURCE = "Muraqib";

const fileIo: PathIo = {
  realpath: (path) => fs.realpath(path),
  isFile: async (path) => (await fs.stat(path)).isFile(),
};

function newNonce(): string {
  return randomBytes(16).toString("base64url");
}

function pickWorkspaceRoot(): string | undefined {
  const active = vscode.window.activeTextEditor?.document.uri;
  const folder = (active !== undefined ? vscode.workspace.getWorkspaceFolder(active) : undefined) ?? vscode.workspace.workspaceFolders?.[0];
  return folder?.uri.scheme === "file" ? folder.uri.fsPath : undefined;
}

const SEVERITIES: Record<DiagnosticLevel, vscode.DiagnosticSeverity> = {
  error: vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning,
  information: vscode.DiagnosticSeverity.Information,
};

function toDiagnostic(spec: DiagnosticSpec): vscode.Diagnostic {
  const position = new vscode.Position(spec.line, spec.column);
  const diagnostic = new vscode.Diagnostic(new vscode.Range(position, position), spec.message, SEVERITIES[spec.level]);
  diagnostic.source = SOURCE;
  diagnostic.code = spec.code;
  return diagnostic;
}

/** Owns the report webview panel and routes its (untrusted) messages to the session. */
class ReportView implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;

  constructor(
    private readonly session: AuditSession,
    private readonly actions: { runAudit(): Promise<void>; showDocs(): Promise<void> }
  ) {}

  show(): void {
    if (this.panel === undefined) {
      const panel = vscode.window.createWebviewPanel("muraqib.report", "Muraqib Report", vscode.ViewColumn.Beside, {
        enableScripts: true,
        localResourceRoots: [],
      });
      panel.onDidDispose(() => {
        this.panel = undefined;
      });
      panel.webview.onDidReceiveMessage((raw: unknown) => void this.handle(raw));
      this.panel = panel;
    } else {
      this.panel.reveal(undefined, true);
    }
    this.render(this.session.running);
  }

  /** Re-render when a report arrives or the run state changes. */
  render(busy: boolean): void {
    if (this.panel === undefined) return;
    const options = { nonce: newNonce(), language: vscode.env.language, busy };
    const report = this.session.lastReport;
    this.panel.webview.html = report === undefined ? renderPlaceholderHtml(options) : renderReportHtml(report, options);
  }

  setBusy(busy: boolean): void {
    const message: HostToWebviewMessage = { type: "busy", busy };
    void this.panel?.webview.postMessage(message);
  }

  dispose(): void {
    this.panel?.dispose();
  }

  private async handle(raw: unknown): Promise<void> {
    const message = parseWebviewMessage(raw);
    if (message === undefined) return; // never act on malformed webview input
    switch (message.type) {
      case "ready":
        return;
      case "runAudit":
        return this.actions.runAudit();
      case "showDocs":
        return this.actions.showDocs();
      case "openFile": {
        const target = await resolveOpenRequest(message, this.session.lastWorkspaceRoot, this.session.reportedFiles, fileIo);
        if (target === undefined) {
          void vscode.window.showWarningMessage("Muraqib: that file is outside the workspace or no longer exists.");
          return;
        }
        const document = await vscode.workspace.openTextDocument(vscode.Uri.file(target.path));
        const position = new vscode.Position(target.line - 1, target.column - 1);
        await vscode.window.showTextDocument(document, { selection: new vscode.Range(position, position), preview: false });
      }
    }
  }
}

/** Shows the static documentation page from muraqib-core in a script-enabled, resource-less webview. */
class DocsView implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;

  async show(): Promise<void> {
    try {
      const html = await lazyEngine.getDocsHtml(newNonce());
      if (this.panel === undefined) {
        this.panel = vscode.window.createWebviewPanel("muraqib.docs", "Muraqib Documentation", vscode.ViewColumn.Active, {
          enableScripts: true,
          localResourceRoots: [],
        });
        this.panel.onDidDispose(() => {
          this.panel = undefined;
        });
      } else {
        this.panel.reveal();
      }
      this.panel.webview.html = html;
    } catch (error) {
      void vscode.window.showErrorMessage(`Muraqib: cannot show documentation (${error instanceof Error ? error.message : String(error)})`);
    }
  }

  dispose(): void {
    this.panel?.dispose();
  }
}

/** Extension entry point. */
export function activate(context: vscode.ExtensionContext): void {
  const diagnostics = vscode.languages.createDiagnosticCollection("muraqib");
  const statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  statusItem.command = "muraqib.showLastReport";
  const docs = new DocsView();
  // Assigned after the session exists because the session's onState callback re-renders the view.
  const ui: { view: ReportView | undefined } = { view: undefined };

  const applyStatus = (state: StatusState): void => {
    const status = formatStatus(state);
    statusItem.text = status.text;
    statusItem.tooltip = status.tooltip;
    statusItem.backgroundColor =
      status.level === "none" ? undefined : new vscode.ThemeColor(status.level === "error" ? "statusBarItem.errorBackground" : "statusBarItem.warningBackground");
  };

  const session = new AuditSession({
    engine: lazyEngine,
    workspaceRoot: pickWorkspaceRoot,
    readOptions: (root) => toAuditOptions(vscode.workspace.getConfiguration("muraqib"), root),
    onState: (state) => {
      applyStatus(state);
      if (state.kind === "running") ui.view?.setBusy(true);
      else ui.view?.render(false);
    },
    applyDiagnostics: (byPath) => {
      diagnostics.clear();
      for (const [path, specs] of byPath) diagnostics.set(vscode.Uri.file(path), specs.map(toDiagnostic));
    },
  });

  const runAudit = async (): Promise<void> => {
    const outcome = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window, title: "Muraqib: auditing" },
      () => session.run()
    );
    // Findings and an unreliable audit are reported, never thrown: process.exitCode is left alone.
    if (outcome.kind === "no-workspace") {
      void vscode.window.showWarningMessage("Muraqib: open a local folder to run an audit.");
    } else if (outcome.kind === "failed") {
      void vscode.window.showErrorMessage(`Muraqib: audit failed - ${outcome.message}`);
    } else if (outcome.report.verdict === "pass") {
      void vscode.window.showInformationMessage(`Muraqib: pass (${outcome.report.summary.total} issue(s)).`);
    } else {
      const choice = await vscode.window.showWarningMessage(
        `Muraqib: ${outcome.report.summary.critical + outcome.report.summary.error} blocking issue(s) found.`,
        "Show Report"
      );
      if (choice === "Show Report") ui.view?.show();
    }
  };

  const view = new ReportView(session, { runAudit, showDocs: () => docs.show() });
  ui.view = view;
  applyStatus({ kind: "idle" });
  statusItem.show();

  context.subscriptions.push(
    diagnostics,
    statusItem,
    docs,
    view,
    vscode.commands.registerCommand("muraqib.runAudit", async () => {
      ui.view?.show();
      await runAudit();
    }),
    vscode.commands.registerCommand("muraqib.showDocumentation", () => docs.show()),
    vscode.commands.registerCommand("muraqib.showLastReport", () => ui.view?.show())
  );
}

/** Extension exit point; disposables registered in {@link activate} clean up everything. */
export function deactivate(): void {
  // Nothing to release beyond context.subscriptions.
}
