import type { AgentReport } from "./types.js";

/** Where the status bar item stands. */
export type StatusState =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "done"; report: AgentReport }
  | { kind: "failed"; message: string };

/** Visual emphasis; the adapter maps it to a status bar background colour. */
export type StatusLevel = "none" | "warning" | "error";

/** Text and tooltip for the status bar item, free of `vscode` types. */
export interface StatusView {
  text: string;
  tooltip: string;
  level: StatusLevel;
}

/** Compute what the status bar item shows. Codicon names (`$(...)`) are rendered by VS Code. */
export function formatStatus(state: StatusState): StatusView {
  switch (state.kind) {
    case "idle":
      return { text: "$(shield) Muraqib", tooltip: "Muraqib: click to run an audit", level: "none" };
    case "running":
      return { text: "$(sync~spin) Muraqib", tooltip: "Muraqib: audit running", level: "none" };
    case "failed":
      return { text: "$(alert) Muraqib: failed", tooltip: `Muraqib: audit could not run (${state.message})`, level: "error" };
    case "done": {
      const { critical, error, warning, info, total } = state.report.summary;
      const blocking = critical + error;
      const unreliable = state.report.ok !== true;
      const text = unreliable
        ? `$(alert) Muraqib: ${total} (unreliable)`
        : total === 0
          ? "$(pass) Muraqib: 0"
          : `$(error) ${blocking} $(warning) ${warning} $(info) ${info}`;
      const tooltip =
        `Muraqib: ${total} issue(s) - ${critical} critical, ${error} error, ${warning} warning, ${info} info` +
        (unreliable ? "; the audit did not complete reliably" : "");
      const level: StatusLevel = unreliable || blocking > 0 ? "error" : warning > 0 ? "warning" : "none";
      return { text, tooltip, level };
    }
  }
}
