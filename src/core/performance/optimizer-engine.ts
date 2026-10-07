export interface HttpProfileAnalysis {
  /** Real problems that should be fixed. */
  issues: string[];
  /** Informational remarks that do not count as failures. */
  notes: string[];
}

export const analyzeHttpProfile = (
  resourceCount: number,
  protocol: string,
  cookiesSize: number
): HttpProfileAnalysis => {
  const issues: string[] = [];
  const notes: string[] = [];

  if (resourceCount > 50) {
    issues.push('Note: The page loads more than 50 resources which may indicate heavy bundling or many network requests.');
  }

  if (cookiesSize > 2 * 1024) {
    issues.push("تحذير: حجم الكوكيز يتجاوز 2KB. كل طلب سيتم تحميله ببيانات غير ضرورية.");
  }

  if (protocol === 'HTTP/2') {
    notes.push("ملاحظة: أنتِ تستخدمين HTTP/2. تأكدي من إزالة الـ Domain Sharding والـ Bundle-ing غير الضروري.");
  } else {
    issues.push("تنبيه: أنتِ على بروتوكول قديم (HTTP/1.x). قد تحتاجين لدمج الملفات (Concatenation) للالتفاف على القيود.");
  }

  return { issues, notes };
};

/** Flat list of every finding (issues followed by notes). */
export const auditPerformance = (resourceCount: number, protocol: string, cookiesSize: number): string[] => {
  const { issues, notes } = analyzeHttpProfile(resourceCount, protocol, cookiesSize);
  return [...issues, ...notes];
};
