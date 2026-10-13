/**
 * Typed postMessage protocol between the extension host and the report webview.
 * Everything arriving from the webview is untrusted: use {@link parseWebviewMessage}.
 */

/** Longest file path the host will consider from the webview. */
export const MAX_PATH_LENGTH = 4096;
/** Largest line or column number accepted from the webview. */
export const MAX_POSITION = 10_000_000;

/** Messages the webview may send to the host. */
export type WebviewToHostMessage =
  | { type: "ready" }
  | { type: "runAudit" }
  | { type: "showDocs" }
  | { type: "openFile"; file: string; line?: number; column?: number };

/** Messages the host sends to the webview. */
export type HostToWebviewMessage = { type: "busy"; busy: boolean };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPosition(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MAX_POSITION;
}

/** Type guard: a plain string path of acceptable size without NUL bytes. */
export function isSafePathString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_PATH_LENGTH && !value.includes("\0");
}

/**
 * Validate an untrusted value received from the webview.
 * Returns a freshly built message containing only known fields, or `undefined` when the value
 * is not a well-formed message (unknown type, wrong field types, out-of-range numbers).
 */
export function parseWebviewMessage(value: unknown): WebviewToHostMessage | undefined {
  if (!isRecord(value)) return undefined;
  switch (value["type"]) {
    case "ready":
      return { type: "ready" };
    case "runAudit":
      return { type: "runAudit" };
    case "showDocs":
      return { type: "showDocs" };
    case "openFile": {
      const file = value["file"];
      if (!isSafePathString(file)) return undefined;
      const line = value["line"];
      const column = value["column"];
      if (line !== undefined && !isPosition(line)) return undefined;
      if (column !== undefined && !isPosition(column)) return undefined;
      const message: WebviewToHostMessage = { type: "openFile", file };
      if (line !== undefined) message.line = line;
      if (column !== undefined) message.column = column;
      return message;
    }
    default:
      return undefined;
  }
}

/** Type guard for the webview-to-host protocol. */
export function isWebviewToHostMessage(value: unknown): value is WebviewToHostMessage {
  return parseWebviewMessage(value) !== undefined;
}
