/**
 * Progress indicators and timing metrics for audit operations.
 * Provides visual feedback during long-running tasks.
 */
import * as logger from "./logger.js";

export type AuditTimer = StepTimer;

class SimpleProgress {
  private silent: boolean;
  private title: string;
  private startTime: number;
  private lastUpdate: number;

  constructor(title = "Processing", silent = false) {
    this.title = title;
    this.silent = silent;
    this.startTime = Date.now();
    this.lastUpdate = this.startTime;
  }

  start(): void {
    if (!this.silent) {
      logger.log(`⏳ ${this.title}...`);
    }
  }

  update(message: string, count?: number): void {
    if (this.silent) return;
    const now = Date.now();
    if (now - this.lastUpdate >= 500) {
      const duration = ((now - this.startTime) / 1000).toFixed(1);
      const countStr = count !== undefined ? ` (${count} items)` : "";
      logger.log(`  ⚙️  ${message}${countStr} [${duration}s]`);
      this.lastUpdate = now;
    }
  }

  succeed(message?: string, fileCount?: number): void {
    if (!this.silent) {
      const duration = ((Date.now() - this.startTime) / 1000).toFixed(1);
      const msg = message ?? "✅ Done";
      const countStr = fileCount !== undefined ? ` (${fileCount} files scanned)` : "";
      logger.log(`✅ ${msg}${countStr} [${duration}s]\n`);
    }
  }

  fail(error: string): void {
    if (!this.silent) {
      const duration = ((Date.now() - this.startTime) / 1000).toFixed(1);
      logger.log(`❌ ${error} [${duration}s]\n`);
    }
  }

  getDuration(): number {
    return Date.now() - this.startTime;
  }
}

class StepTimer implements AuditTimer {
  private startTime = 0;
  private silent: boolean;

  constructor(private name: string, silent = false) {
    this.silent = silent;
  }

  start(): void {
    this.startTime = Date.now();
    if (!this.silent && !logger.isSilentMode()) {
      process.stdout.write(`  ⚡ ${this.name}...`);
    }
  }

  end(): string {
    const duration = ((Date.now() - this.startTime) / 1000).toFixed(2);
    if (!this.silent) {
      logger.log(` ✓ (${duration}s)`);
    }
    return duration;
  }

  getDuration(): number {
    return Date.now() - this.startTime;
  }
}

/**
 * Create progress.
 *
 * @param title - Title
 * @param silent - Silent
 * @returns Create progress result
 */
export function createProgress(title: string, silent = false): SimpleProgress {
  return new SimpleProgress(title, silent);
}

/**
 * Create timer.
 *
 * @param name - Name
 * @param silent - Silent
 * @returns Create timer result
 */
export function createTimer(name: string, silent = false): AuditTimer {
  return new StepTimer(name, silent);
}

export interface AuditMetrics {
  moduleName: string;
  duration: number;
  filesScanned?: number | undefined;
  itemsFound?: number | undefined;
}

/**
 * Metrics collector class.
 */
export class MetricsCollector {
  private metrics: AuditMetrics[] = [];
  private silent: boolean;

  constructor(silent = false) {
    this.silent = silent;
  }

  /**
   * Record.
   *
   * @param moduleName - Module name
   * @param duration - Duration
   * @param filesScanned - Files scanned
   * @param itemsFound - Items found
   */
  record(moduleName: string, duration: number, filesScanned?: number, itemsFound?: number): void {
    this.metrics.push({
      moduleName,
      duration,
      filesScanned: filesScanned ?? undefined,
      itemsFound: itemsFound ?? undefined
    });
  }

  /**
   * Print summary.
   */
  printSummary(): void {
    if (this.silent || this.metrics.length === 0) return;

    logger.log("\n📊 Audit Performance Metrics:");
    logger.log("────────────────────────────");

    let totalTime = 0;
    let totalFiles = 0;

    for (const m of this.metrics) {
      totalTime += m.duration;
      const fileStr = m.filesScanned !== undefined ? ` | ${m.filesScanned} files` : "";
      const itemStr = m.itemsFound !== undefined ? ` | ${m.itemsFound} found` : "";
      logger.log(`  ${m.moduleName.padEnd(20)} ${(m.duration / 1000).toFixed(2)}s${fileStr}${itemStr}`);
      if (m.filesScanned) totalFiles += m.filesScanned;
    }

    logger.log("────────────────────────────");
    logger.log(`  Total Time: ${(totalTime / 1000).toFixed(2)}s`);
    if (totalFiles > 0) logger.log(`  Total Files: ${totalFiles}`);
    logger.log("");
  }

  /**
   * Get metrics.
   *
   * @returns Get metrics result
   */
  getMetrics(): AuditMetrics[] {
    return [...this.metrics];
  }
}
