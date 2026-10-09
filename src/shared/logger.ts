// Global logger with silent mode support
let silent = false;

export function setSilentMode(isSilent: boolean) {
  silent = isSilent;
}

export function log(message: string, ...args: unknown[]) {
  if (!silent) console.log(message, ...args);
}

export function error(message: string, ...args: unknown[]) {
  if (!silent) console.error(message, ...args);
}

export function warn(message: string, ...args: unknown[]) {
  if (!silent) console.warn(message, ...args);
}
