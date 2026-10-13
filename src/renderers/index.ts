import { COLORS } from "../shared/constants.js";

const { RESET, RED, GREEN, YELLOW, CYAN, DIM, BOLD } = COLORS;

let isSilent = false;

/**
 * Set silent.
 *
 * @param silent - Silent
 */
export function setSilent(silent: boolean): void {
  isSilent = silent;
}

/**
 * Log.
 *
 * @param title - Title
 * @param status - Status
 * @param message - Message
 */
export function log(title: string, status: "pass" | "fail" | "warn", message?: string): void {
  if (isSilent) return;
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
  if (isSilent) return;
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
  if (isSilent) return;
  const width = Math.max(...lines.map((l) => l.length), 40);
  console.log(`  ${DIM}┌${"─".repeat(width + 2)}┐${RESET}`);
  for (const line of lines) {
    console.log(`  ${DIM}│${RESET} ${line.padEnd(width)} ${DIM}│${RESET}`);
  }
  console.log(`  ${DIM}└${"─".repeat(width + 2)}┘${RESET}`);
}

/**
 * Render header.
 *
 * @param targetPath - Target path
 */
export function renderHeader(targetPath: string): void {
  if (isSilent) return;
  console.log(`
${CYAN}${BOLD}╔════════════════════════════════════════════════════════════╗${RESET}`);
  console.log(`${CYAN}${BOLD}║        MURAQIB — COMPREHENSIVE AUDIT REPORT              ║${RESET}`);
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
