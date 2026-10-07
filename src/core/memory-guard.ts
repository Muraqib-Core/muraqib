/**
 * @file memory-guard.ts
 * @description فحص استهلاك الذاكرة اللحظي للعملية الحالية (Node process).
 * يُستخدم كـ smoke check أثناء تشغيل عمليات الـ audit الطويلة لمراقبة الأداء
 * والكشف المبكر عن أي ارتفاع غير طبيعي في الذاكرة.
 */
import v8 from "v8";

export interface MemoryAuditResult {
  isOptimized: boolean;
  reports: string[];
  heapUsedMb: number;
  heapTotalMb: number;
  rssMb: number;
  externalMb: number;
  arrayBuffersMb: number;
  leakRisk: "none" | "low" | "medium" | "high";
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

export function performMemoryAudit(options: MemoryAuditOptions = {}): MemoryAuditResult {
  const config = { ...DEFAULT_OPTIONS, ...options };
  const mem = process.memoryUsage();
  const heapStats = v8.getHeapStatistics();

  const heapUsedMb = Math.round(mem.heapUsed / 1024 / 1024);
  const heapTotalMb = Math.round(mem.heapTotal / 1024 / 1024);
  const rssMb = Math.round(mem.rss / 1024 / 1024);
  const externalMb = Math.round((mem.external || 0) / 1024 / 1024);
  const arrayBuffersMb = Math.round((mem.arrayBuffers || 0) / 1024 / 1024);

  const reports: string[] = [];
  const heapRatio = heapStats.used_heap_size / heapStats.total_heap_size;

  if (heapUsedMb > config.heapCriticalMb) {
    reports.push(`Critical heap usage: ${heapUsedMb} MB (limit: ${config.heapCriticalMb} MB)`);
  } else if (heapUsedMb > config.heapWarnMb) {
    reports.push(`High heap usage: ${heapUsedMb} MB (warn: ${config.heapWarnMb} MB)`);
  }

  if (rssMb > config.rssWarnMb) {
    reports.push(`High RSS memory: ${rssMb} MB (warn: ${config.rssWarnMb} MB)`);
  }

  if (externalMb > config.externalWarnMb) {
    reports.push(`High external memory: ${externalMb} MB (warn: ${config.externalWarnMb} MB)`);
  }

  if (heapRatio > config.heapRatioWarn) {
    reports.push(`Heap fragmentation risk: ${(heapRatio * 100).toFixed(1)}% used`);
  }

  let leakRisk: MemoryAuditResult["leakRisk"] = "none";
  if (reports.length >= 3) leakRisk = "high";
  else if (reports.length === 2) leakRisk = "medium";
  else if (reports.length === 1) leakRisk = "low";

  return {
    isOptimized: reports.length === 0,
    reports,
    heapUsedMb,
    heapTotalMb,
    rssMb,
    externalMb,
    arrayBuffersMb,
    leakRisk,
  };
}