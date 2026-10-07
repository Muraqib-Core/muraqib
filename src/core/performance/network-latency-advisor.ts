import axios from 'axios';

export interface LatencyAuditResult {
  isOptimized: boolean;
  reports: string[];
  requestTimeMs: number;
  payloadSizeKb: number;
  /** False when the target could not be reached — no measurement was taken. */
  reachable: boolean;
}

export const performLiveLatencyAudit = async (url: string): Promise<LatencyAuditResult> => {
    const startTime = Date.now(); 

    try {
        const response = await axios.get(url, { timeout: 10000 });
        const endTime = Date.now();
        const requestTimeMs = endTime - startTime; 
        const contentLength = response.headers['content-length'] as string | undefined;
        const payloadSizeKb = contentLength && typeof contentLength === 'string'
            ? parseInt(contentLength, 10) / 1024
            : Buffer.byteLength(JSON.stringify(response.data)) / 1024;
        const auditResult = analyzeLatency(requestTimeMs, payloadSizeKb);

        console.log(`\n🌐 [Muraqib Network Audit] Results for: ${url}`);
        console.log(`⏱️ Real Latency Measured: ${requestTimeMs}ms`);
        console.log(`📦 Real Payload Size: ${payloadSizeKb.toFixed(2)}KB`);
        
        if (!auditResult.isOptimized) {
            auditResult.reports.forEach(report => console.warn(`⚠️ ${report}`));
        } else {
            console.log("✅ [Muraqib]: Target URL is highly optimized and fast!");
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
        console.error(`❌ [Muraqib Audit Error]: Failed to fetch or measure the URL: ${url} (${reason})`);
        return {
            isOptimized: false,
            reports: [`تعذّر الوصول إلى ${url}: ${reason}`],
            requestTimeMs: 0,
            payloadSizeKb: 0,
            reachable: false
        };
    }
};

export const analyzeLatency = (requestTimeMs: number, payloadSizeKb: number) => {
    const reports: string[] = [];

    if (payloadSizeKb > 14) { 
        reports.push('تحذير: حجم الاستجابة الأولى يتجاوز 14KB. هذا سيسبب رحلة إضافية (Round Trip) بناءً على قيود TCP.');
    }

    if (requestTimeMs > 300) { 
        reports.push('تنبيه: التأخير يتجاوز 300ms. الـ Interaction أصبح بطيئاً (Sluggish) من منظور المستخدم.');
    }

    return {
        isOptimized: reports.length === 0,
        reports
    };
};