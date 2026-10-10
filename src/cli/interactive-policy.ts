/**
 * Decides whether the audit runs with the Clack UI.
 * Deliberately free of terminal-UI imports so the library entry point can use it
 * without loading @clack/prompts.
 */

export interface InteractiveContext {
  /** `-i/--interactive` (true), `--no-interactive` (false) or unset. */
  flag: boolean | undefined;
  format: string;
  hasOutputFile: boolean;
  stdoutIsTTY: boolean;
  stdinIsTTY: boolean;
  env: Record<string, string | undefined>;
}

/**
 * Decide whether the audit should run with the Clack UI.
 * Never interactive for machine output (json/csv/html, --output) or CI.
 */
export function shouldUseInteractive(ctx: InteractiveContext): boolean {
  if (ctx.flag === false) return false;
  if (ctx.format !== "text" || ctx.hasOutputFile) return false;
  if (!ctx.stdoutIsTTY || !ctx.stdinIsTTY) return false;
  if (ctx.env["CI"] !== undefined && ctx.env["CI"] !== "" && ctx.env["CI"] !== "false") return false;
  return true;
}
