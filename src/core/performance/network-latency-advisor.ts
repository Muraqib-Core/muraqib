import { BaseGuard } from '../base-guard.js';
import type { AuditContext, AuditIssue, AuditResult } from '../types.js';
import * as logger from '../../shared/logger.js';

/** Maximum first-response payload (KB) that fits the initial TCP congestion window. */
const MAX_PAYLOAD_KB = 14;
/** Latency (ms) above which an interaction feels sluggish to the user. */
const MAX_LATENCY_MS = 300;
/** Request timeout (ms) for live audits. */
const REQUEST_TIMEOUT_MS = 10000;

export interface LatencyAuditResult {
  isOptimized: boolean;
  reports: string[];
  requestTimeMs: number;
  payloadSizeKb: number;
  /** False when the target could not be reached — no measurement was taken. */
  reachable: boolean;
}

/** Result of the pure latency/payload analysis (no network access). */
export interface LatencyAnalysis {
  isOptimized: boolean;
  reports: string[];
}

/**
 * Analyze a measured request time and payload size against the performance budgets.
 * @param requestTimeMs - Measured round-trip time in milliseconds
 * @param payloadSizeKb - Measured response size in kilobytes
 * @returns Whether the target is within budget, with Arabic reports for each violation
 */
export const analyzeLatency = (requestTimeMs: number, payloadSizeKb: number): LatencyAnalysis => {
  const reports: string[] = [];

  if (payloadSizeKb > MAX_PAYLOAD_KB) {
    reports.push('تحذير: حجم الاستجابة الأولى يتجاوز 14KB. هذا سيسبب رحلة إضافية (Round Trip) بناءً على قيود TCP.');
  }

  if (requestTimeMs > MAX_LATENCY_MS) {
    reports.push('تنبيه: التأخير يتجاوز 300ms. الـ Interaction أصبح بطيئاً (Sluggish) من منظور المستخدم.');
  }

  return {
    isOptimized: reports.length === 0,
    reports,
  };
};

/**
 * Perform a live HTTP request against `url` and measure latency and payload size.
 * An unreachable target is reported as a failed check (`reachable: false`), never as a pass.
 * @param url - Target URL to measure
 * @returns Measured latency audit result
 */
export const performLiveLatencyAudit = async (url: string): Promise<LatencyAuditResult> => {
  const startTime = Date.now();

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
    }
    const body = await response.arrayBuffer();
    const endTime = Date.now();
    const requestTimeMs = endTime - startTime;
    const contentLength = response.headers.get('content-length');
    const payloadSizeKb = contentLength
      ? parseInt(contentLength, 10) / 1024
      : body.byteLength / 1024;
    const auditResult = analyzeLatency(requestTimeMs, payloadSizeKb);

    logger.log(`\n🌐 [Muraqib Network Audit] Results for: ${url}`);
    logger.log(`⏱️ Real Latency Measured: ${requestTimeMs}ms`);
    logger.log(`📦 Real Payload Size: ${payloadSizeKb.toFixed(2)}KB`);

    if (!auditResult.isOptimized) {
      auditResult.reports.forEach(report => logger.warn(`⚠️ ${report}`));
    } else {
      logger.log("✅ [Muraqib]: Target URL is highly optimized and fast!");
    }

    return {
      ...auditResult,
      requestTimeMs,
      payloadSizeKb,
      reachable: true
    };

  } catch (error) {
    // No fallback target: an unreachable URL is a failed check, never a pass.
    const reason = error instanceof Error ? error.message : String(error);
    logger.error(`❌ [Muraqib Audit Error]: Failed to fetch or measure the URL: ${url} (${reason})`);
    return {
      isOptimized: false,
      reports: [`تعذّر الوصول إلى ${url}: ${reason}`],
      requestTimeMs: 0,
      payloadSizeKb: 0,
      reachable: false
    };
  }
};

/** Options for {@link NetworkLatencyGuard}. */
export interface NetworkLatencyGuardOptions {
  /** URL to measure. */
  targetUrl: string;
}

/**
 * NetworkLatencyGuard - measures real response latency and first-payload size of a URL.
 *
 * Severity levels:
 * - `error`: the target was unreachable, so no measurement could be taken (NETWORK_001).
 * - `warning`: payload exceeds 14KB (NETWORK_002) or latency exceeds 300ms (NETWORK_003).
 */
export class NetworkLatencyGuard extends BaseGuard {
  private readonly targetUrl: string;

  /**
   * @param options - Guard options containing the target URL
   * @param context - Optional AuditContext with project metadata
   */
  constructor(options: NetworkLatencyGuardOptions, context?: AuditContext) {
    super('network-latency-guard', context);
    this.targetUrl = options.targetUrl;
  }

  /**
   * Run the live latency audit and convert the findings into structured issues.
   * @returns AuditResult describing latency/payload findings
   */
  async execute(): Promise<AuditResult> {
    const result = await performLiveLatencyAudit(this.targetUrl);

    if (!result.reachable) {
      const unreachable: AuditIssue = this.createIssue(
        'NETWORK_001',
        'error',
        'Target unreachable',
        result.reports[0] ?? `تعذّر الوصول إلى ${this.targetUrl}`,
        undefined,
        'Verify the URL is correct and the server is running.',
        ['network']
      );
      return this.issues([unreachable]);
    }

    if (result.isOptimized) {
      return this.ok(`Network latency is within budget (${result.requestTimeMs}ms, ${result.payloadSizeKb.toFixed(2)}KB)`);
    }

    const found: AuditIssue[] = [];
    if (result.payloadSizeKb > MAX_PAYLOAD_KB) {
      found.push(this.createIssue(
        'NETWORK_002',
        'warning',
        'Large first response',
        analyzeLatency(0, result.payloadSizeKb).reports[0] ?? '',
        undefined,
        'Reduce the first response below 14KB (compress, split or defer content).',
        ['network', 'payload']
      ));
    }
    if (result.requestTimeMs > MAX_LATENCY_MS) {
      found.push(this.createIssue(
        'NETWORK_003',
        'warning',
        'High latency',
        analyzeLatency(result.requestTimeMs, 0).reports[0] ?? '',
        undefined,
        'Investigate server response time, caching and CDN usage.',
        ['network', 'latency']
      ));
    }
    return this.issues(found);
  }
}
