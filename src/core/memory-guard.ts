/**
 * @file memory-guard.ts
 * @description فحص استهلاك الذاكرة اللحظي للعملية الحالية (Node process).
 * يُستخدم كـ smoke check أثناء تشغيل عمليات الـ audit الطويلة لمراقبة الأداء
 * والكشف المبكر عن أي ارتفاع غير طبيعي في الذاكرة.
 */
import v8 from "v8";
import { BaseGuard } from "./base-guard.js";
import type { AuditResult, AuditIssue, AuditContext } from "./types.js";

export interface MemoryAuditResult {
  isOptimized: boolean;
  reports: string[];
  heapUsedMb: number;
  heapTotalMb: number;
  rssMb: number;
  externalMb: number;
  arrayBuffersMb: number;
  /**
   * Heuristic only: derived from how many thresholds were exceeded (0 none, 1 low, 2 medium,
   * 3+ high). It is not a proof of a leak; a single snapshot cannot show growth over time.
   */
  leakRisk: "none" | "low" | "medium" | "high";
  /** Structured findings, one per entry in `reports` (same order). */
  findings: MemoryFinding[];
  /** Notes about options that were invalid and replaced, or thresholds that were reordered. */
  notes: string[];
}

/** A structured memory finding. `code` is stable and never derived from message text. */
export interface MemoryFinding { // muraqib-ignore-dead: structured finding shape of MemoryAuditResult
  code: string;
  severity: "critical" | "error" | "warning" | "info";
  message: string;
  file?: string;
  line?: number;
}

export interface MemoryAuditOptions {
  heapWarnMb?: number;
  heapCriticalMb?: number;
  rssWarnMb?: number;
  externalWarnMb?: number;
  heapRatioWarn?: number;
}

const DEFAULT_OPTIONS: Required<MemoryAuditOptions> = {
  heapWarnMb: 512,
  heapCriticalMb: 1024,
  rssWarnMb: 1024,
  externalWarnMb: 256,
  heapRatioWarn: 0.85,
};

const BYTES_PER_MB = 1024 * 1024;

/** Keeps `value` only when it is a finite, non-negative number; otherwise uses the default. */
function validThreshold(name: keyof MemoryAuditOptions, value: number | undefined, notes: string[]): number {
  const fallback = DEFAULT_OPTIONS[name];
  if (value === undefined) return fallback;
  if (Number.isFinite(value) && value >= 0) return value;
  notes.push(`Invalid ${name} (${String(value)}); using default ${fallback}`);
  return fallback;
}

/** Resolves user options against the defaults, validating every value. */
function resolveOptions(options: MemoryAuditOptions, notes: string[]): Required<MemoryAuditOptions> {
  const config: Required<MemoryAuditOptions> = {
    heapWarnMb: validThreshold("heapWarnMb", options.heapWarnMb, notes),
    heapCriticalMb: validThreshold("heapCriticalMb", options.heapCriticalMb, notes),
    rssWarnMb: validThreshold("rssWarnMb", options.rssWarnMb, notes),
    externalWarnMb: validThreshold("externalWarnMb", options.externalWarnMb, notes),
    heapRatioWarn: validThreshold("heapRatioWarn", options.heapRatioWarn, notes),
  };
  if (config.heapWarnMb > config.heapCriticalMb) {
    notes.push(`heapWarnMb (${config.heapWarnMb}) exceeds heapCriticalMb (${config.heapCriticalMb}); thresholds swapped`);
    [config.heapWarnMb, config.heapCriticalMb] = [config.heapCriticalMb, config.heapWarnMb];
  }
  return config;
}

function performMemoryAuditInternal(options: MemoryAuditOptions = {}): MemoryAuditResult {
  const notes: string[] = [];
  const config = resolveOptions(options, notes);
  const mem = process.memoryUsage();
  const heapStats = v8.getHeapStatistics();

  const heapUsedMb = Math.round(mem.heapUsed / BYTES_PER_MB);
  const heapTotalMb = Math.round(mem.heapTotal / BYTES_PER_MB);
  const rssMb = Math.round(mem.rss / BYTES_PER_MB);
  const externalMb = Math.round((mem.external ?? 0) / BYTES_PER_MB);
  const arrayBuffersMb = Math.round((mem.arrayBuffers ?? 0) / BYTES_PER_MB);

  const findings: MemoryFinding[] = [];
  const heapRatio = heapStats.total_heap_size > 0 ? heapStats.used_heap_size / heapStats.total_heap_size : 0;

  if (heapUsedMb > config.heapCriticalMb) {
    findings.push({ code: "MEMORY_HEAP_CRITICAL", severity: "critical", message: `Critical heap usage: ${heapUsedMb} MB (limit: ${config.heapCriticalMb} MB)` });
  } else if (heapUsedMb > config.heapWarnMb) {
    findings.push({ code: "MEMORY_HEAP_HIGH", severity: "error", message: `High heap usage: ${heapUsedMb} MB (warn: ${config.heapWarnMb} MB)` });
  }

  if (rssMb > config.rssWarnMb) {
    findings.push({ code: "MEMORY_RSS_HIGH", severity: "error", message: `High RSS memory: ${rssMb} MB (warn: ${config.rssWarnMb} MB)` });
  }

  if (externalMb > config.externalWarnMb) {
    findings.push({ code: "MEMORY_EXTERNAL_HIGH", severity: "error", message: `High external memory: ${externalMb} MB (warn: ${config.externalWarnMb} MB)` });
  }

  if (heapRatio > config.heapRatioWarn) {
    findings.push({ code: "MEMORY_HEAP_FRAGMENTATION", severity: "warning", message: `Heap fragmentation risk: ${(heapRatio * 100).toFixed(1)}% used` });
  }

  let leakRisk: MemoryAuditResult["leakRisk"] = "none";
  if (findings.length >= 3) leakRisk = "high";
  else if (findings.length === 2) leakRisk = "medium";
  else if (findings.length === 1) leakRisk = "low";

  return {
    isOptimized: findings.length === 0,
    reports: findings.map((finding) => finding.message),
    heapUsedMb,
    heapTotalMb,
    rssMb,
    externalMb,
    arrayBuffersMb,
    leakRisk,
    findings,
    notes,
  };
}

/**
 * Inspects heap, RSS and external memory usage and flags leak risk against configurable thresholds.
 * Severity levels used: warning, critical, error.
 */
export class MemoryGuard extends BaseGuard {
  private options: MemoryAuditOptions;

  constructor(options: MemoryAuditOptions = {}, context?: AuditContext) {
    super("memory-guard", context);
    this.options = options;
  }

  /**
   * Execute.
   *
   * @returns Execute result
   */
  async execute(): Promise<AuditResult> {
    const result = performMemoryAuditInternal(this.options);

    const issues: AuditIssue[] = [];

    for (const finding of result.findings) {
      issues.push(
        this.createIssue(
          finding.code,
          finding.severity,
          "Memory Usage Issue",
          finding.message,
          finding.file === undefined ? undefined : { file: finding.file, ...(finding.line === undefined ? {} : { line: finding.line }) },
          "Monitor and optimize memory consumption"
        )
      );
    }

    if (issues.length === 0) {
      return this.ok(`Memory usage optimal: Heap ${result.heapUsedMb}MB / RSS ${result.rssMb}MB`);
    }

    return this.issues(issues, `Found ${issues.length} memory issue(s)`);
  }
}

/**
 * @deprecated Use MemoryGuard class instead
 */
export function performMemoryAudit(options: MemoryAuditOptions = {}): MemoryAuditResult {
  return performMemoryAuditInternal(options);
}