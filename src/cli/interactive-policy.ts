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

export type AuditCategoryId = "security" | "performance" | "configuration" | "code" | "full";

export interface AuditCategory {
  id: AuditCategoryId;
  label: string;
  hint: string;
  /** Guard-name substrings passed to the module filter; empty means "run everything". */
  modules: readonly string[];
}

/** Categories offered by the interactive picker, in display order. */
export const AUDIT_CATEGORIES: readonly AuditCategory[] = [
  { id: "full", label: "Full comprehensive audit", hint: "every guard", modules: [] },
  { id: "security", label: "Security", hint: "headers & secrets", modules: ["security-guard"] },
  {
    id: "performance",
    label: "Performance & images",
    hint: "image sizes, memory, async patterns",
    modules: ["image-guard", "memory-guard", "async-guard"],
  },
  {
    id: "configuration",
    label: "Configuration",
    hint: "config, compatibility, Docker",
    modules: ["config-guard", "compatibility-guard", "docker-guard"],
  },
  { id: "code", label: "Code health", hint: "dependencies & dead code", modules: ["dependency-guard", "dead-code-guard"] },
];

/** Module filter for the chosen categories; undefined means no filter (run everything). */
export function resolveCategoryModules(ids: readonly AuditCategoryId[]): string[] | undefined {
  if (ids.length === 0 || ids.includes("full")) return undefined;
  const modules = new Set<string>();
  for (const category of AUDIT_CATEGORIES) {
    if (ids.includes(category.id)) category.modules.forEach((m) => modules.add(m));
  }
  return [...modules];
}
