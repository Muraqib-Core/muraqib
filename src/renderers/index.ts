import { COLORS } from "../shared/constants.js";
import { isSilentMode, setSilentMode } from "../shared/logger.js";

const { RESET, RED, GREEN, YELLOW, CYAN, DIM, BOLD } = COLORS;

/**
 * Silences (or restores) the report renderers. They share one flag with the logger, so a single
 * call silences every piece of console output of the audit.
 *
 * @param silent - True to suppress output
 */
export const setSilent: (silent: boolean) => void = setSilentMode;

// eslint-disable-next-line no-control-regex -- strips SGR color sequences
const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;

/** Length of `text` as the terminal shows it, ignoring color escape sequences. */
function visibleLength(text: string): number {
  return text.replace(ANSI_PATTERN, "").length;
}

/**
 * Log.
 *
 * @param title - Title
 * @param status - Status
 * @param message - Message
 */
export function log(title: string, status: "pass" | "fail" | "warn", message?: string): void {
  if (isSilentMode()) return;
  const icon = status === "pass"
    ? `${GREEN}[PASS]${RESET}`
    : status === "fail"
      ? `${RED}[FAIL]${RESET}`
      : `${YELLOW}[WARN]${RESET}`;
  console.log(`  ${icon} ${title}${message ? `: ${message}` : ""}`);
}

/**
 * Section.
 *
 * @param name - Name
 */
export function section(name: string): void {
  if (isSilentMode()) return;
  console.log(`
${CYAN}${BOLD}${name}${RESET}`);
  console.log(`${DIM}${"-".repeat(60)}${RESET}`);
}

/**
 * Box.
 *
 * @param lines - Lines
 */
export function box(lines: string[]): void {
  if (isSilentMode()) return;
  const width = Math.max(...lines.map(visibleLength), 40);
  console.log(`  ${DIM}┌${"─".repeat(width + 2)}┐${RESET}`);
  for (const line of lines) {
    console.log(`  ${DIM}│${RESET} ${line}${" ".repeat(width - visibleLength(line))} ${DIM}│${RESET}`);
  }
  console.log(`  ${DIM}└${"─".repeat(width + 2)}┘${RESET}`);
}

const HEADER_INNER_WIDTH = 60;
const HEADER_TITLE = "MURAQIB — COMPREHENSIVE AUDIT REPORT";
const HEADER_TITLE_LINE = `║${HEADER_TITLE.padStart(Math.floor((HEADER_INNER_WIDTH + HEADER_TITLE.length) / 2)).padEnd(HEADER_INNER_WIDTH)}║`;

/**
 * Render header.
 *
 * @param targetPath - Target path
 */
export function renderHeader(targetPath: string): void {
  if (isSilentMode()) return;
  console.log(`
${CYAN}${BOLD}╔════════════════════════════════════════════════════════════╗${RESET}`);
  console.log(`${CYAN}${BOLD}${HEADER_TITLE_LINE}${RESET}`);
  console.log(`${CYAN}${BOLD}╚════════════════════════════════════════════════════════════╝${RESET}`);
  console.log(`${DIM}Target: ${targetPath}${RESET}
`);
}

/**
 * Render summary.
 *
 * @param allOk - All ok
 * @param skippedCount - Skipped count
 * @param criticalCount - Critical count
 * @param warningCount - Warning count
 */
export function renderSummary(allOk: boolean, skippedCount: number, criticalCount: number, warningCount: number): void {
  if (allOk) {
    box(
      skippedCount > 0
        ? [
            `${GREEN}${BOLD}✅ All executed checks passed.${RESET}`,
            `${YELLOW}${skippedCount} check(s) were skipped and are not verified.${RESET}`,
          ]
        : [
            `${GREEN}${BOLD}✅ All checks passed!${RESET}`,
            `${DIM}Your project is clean and optimized.${RESET}`,
          ]
    );
  } else {
    box([
      `${RED}${BOLD}❌ Audit completed with failures.${RESET}`,
      `${DIM}Critical: ${criticalCount} | Warnings: ${warningCount}${RESET}`,
      `${DIM}Review the issues above and fix your project.${RESET}`,
    ]);
  }
}

/**
 * Format colorized status.
 *
 * @param status - Status
 * @returns Format colorized status result
 */
export function formatColorizedStatus(status: "pass" | "fail" | "warn" | "skip"): string {
  switch (status) {
    case "pass":
      return `${GREEN}PASS${RESET}`;
    case "fail":
      return `${RED}FAIL${RESET}`;
    case "warn":
      return `${YELLOW}WARN${RESET}`;
    case "skip":
      return `${DIM}SKIP${RESET}`;
  }
}

/**
 * Get detail color.
 *
 * @param status - Status
 * @param skipped - Skipped
 * @param count - Count
 * @returns Get detail color result
 */
export function getDetailColor(status: boolean, skipped: boolean, count: number): { color: string; text: string } {
  if (skipped) return { color: DIM, text: "not run" };
  if (status) return { color: GREEN, text: "clean" };
  return { color: count > 0 ? YELLOW : RED, text: `${count} issue(s)` };
}

export const Colors = {
  ...COLORS,
  RESET: COLORS.RESET,
  RED: COLORS.RED,
  GREEN: COLORS.GREEN,
  YELLOW: COLORS.YELLOW,
  CYAN: COLORS.CYAN,
  DIM: COLORS.DIM,
  BOLD: COLORS.BOLD,
};
