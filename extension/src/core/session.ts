import type { AgentAuditOptions, AgentReport } from "./types.js";
import { collectReportedFiles, mapIssuesToDiagnostics, type DiagnosticSpec } from "./diagnostics.js";
import type { StatusState } from "./status.js";

/** The slice of muraqib-core the extension uses; the host adapter wires the real functions in. */
export interface AuditEngine {
  runAudit(options: AgentAuditOptions): Promise<AgentReport>;
  getDocsHtml(nonce: string): Promise<string>;
}

/** Side effects of a session, implemented by the VS Code adapter and by fakes in tests. */
export interface SessionPorts {
  engine: AuditEngine;
  /** Root folder to audit, or `undefined` when no folder is open. */
  workspaceRoot(): string | undefined;
  /** Current engine options for that root. */
  readOptions(root: string): AgentAuditOptions;
  /** Called on every state change (status bar, webview busy flag, notifications). */
  onState(state: StatusState): void;
  /** Replace all Problems-panel entries (an empty map clears them). */
  applyDiagnostics(byPath: Map<string, DiagnosticSpec[]>): void;
}

/** Result of {@link AuditSession.run}. */
export type RunOutcome =
  | { kind: "no-workspace" }
  | { kind: "done"; report: AgentReport }
  | { kind: "failed"; message: string; report?: AgentReport };

/**
 * Orchestrates one audit at a time and remembers the last report. Never throws and never
 * touches `process.exitCode`: an audit that cannot run (`ok:false`, exit code 3) or that finds
 * problems (exit code 1) is data to display, not a reason to crash the extension host.
 */
export class AuditSession {
  private last: AgentReport | undefined;
  private lastRoot: string | undefined;
  private inFlight: Promise<RunOutcome> | undefined;

  constructor(private readonly ports: SessionPorts) {}

  /** The most recent report, if any audit has completed. */
  get lastReport(): AgentReport | undefined {
    return this.last;
  }

  /** The workspace root the last report was produced for. */
  get lastWorkspaceRoot(): string | undefined {
    return this.lastRoot;
  }

  /** True while an audit is running. */
  get running(): boolean {
    return this.inFlight !== undefined;
  }

  /** Files named by the last report: the only ones the webview may ask the host to open. */
  get reportedFiles(): Set<string> {
    return this.last === undefined ? new Set() : collectReportedFiles(this.last);
  }

  /** Run an audit; concurrent calls share the audit already in progress. */
  run(): Promise<RunOutcome> {
    this.inFlight ??= this.execute().finally(() => {
      this.inFlight = undefined;
    });
    return this.inFlight;
  }

  private async execute(): Promise<RunOutcome> {
    const root = this.ports.workspaceRoot();
    if (root === undefined) return { kind: "no-workspace" };
    this.ports.onState({ kind: "running" });
    try {
      const report = await this.ports.engine.runAudit(this.ports.readOptions(root));
      this.last = report;
      this.lastRoot = root;
      this.ports.applyDiagnostics(mapIssuesToDiagnostics(report, root));
      this.ports.onState({ kind: "done", report });
      if (report.ok !== true) {
        return { kind: "failed", message: report.error ?? "the audit did not complete reliably (scanner failure)", report };
      }
      return { kind: "done", report };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.ports.onState({ kind: "failed", message });
      return { kind: "failed", message };
    }
  }
}
