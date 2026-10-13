/**
 * Global logger with silent mode support.
 * All non-CLI output should go through these helpers so that silent mode is honoured.
 */
let silent = false;

/**
 * Enable or disable silent mode. While silent, log/warn/error produce no output.
 * @param isSilent - True to suppress all logger output
 */
export function setSilentMode(isSilent: boolean): void {
  silent = isSilent;
}

/**
 * Report whether silent mode is currently enabled.
 * @returns True when logger output is suppressed
 */
export function isSilentMode(): boolean {
  return silent;
}

/**
 * Write an informational message to stdout unless silent mode is on.
 * @param message - Message to print
 * @param args - Additional values passed to console.log
 */
export function log(message: string, ...args: unknown[]): void {
  if (!silent) console.log(message, ...args);
}

/**
 * Write an error message to stderr unless silent mode is on.
 * @param message - Message to print
 * @param args - Additional values passed to console.error
 */
export function error(message: string, ...args: unknown[]): void {
  if (!silent) console.error(message, ...args);
}

/**
 * Write a warning message to stderr unless silent mode is on.
 * @param message - Message to print
 * @param args - Additional values passed to console.warn
 */
export function warn(message: string, ...args: unknown[]): void {
  if (!silent) console.warn(message, ...args);
}
