export type EnvUpdateStrategy = "replace" | "keep-both" | "merge"; // muraqib-ignore-dead: auto-suppressed by script for EnvUpdateStrategy

export interface NewEnvConfig { // muraqib-ignore-dead: auto-suppressed by script for NewEnvConfig
  currentValue: string;          // القيمة القديمة من ملف الـ .env الحالي
  newValue: string;              // القيمة الجديدة المراد تحديثها
  updateStrategy: EnvUpdateStrategy; // الاستراتيجية المختارة للتحديث
  secretKey?: string;             // اسم المتغير (مثال: DATABASE_URL)
}

/** Trims a value and strips one pair of wrapping quotes, only when both ends carry the same quote character. */
function stripMatchingQuotes(raw: string): string {
  const trimmed = raw.trim();
  const first = trimmed.charAt(0);
  if (trimmed.length >= 2 && (first === '"' || first === "'") && trimmed.endsWith(first)) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/**
 * دالة Muraqib لتطهير وصياغة قيم متغيرات البيئة بناءً على استراتيجيات هندسية مرنة
 *
 * Quotes are stripped only when both ends match (`"a"`, `'a'`), never a lone quote.
 * An empty new value or an identical value returns `currentValue` untouched; the function never returns null.
 *
 * Note on `keep-both`: it yields the fallback EXPRESSION `"old" || "new"`. That is meant for config
 * templates / code that evaluates the expression, not for a raw `.env` file, where it would become a literal string.
 */
export function getNewEnvValue({ // muraqib-ignore-dead: auto-suppressed by script for getNewEnvValue
  currentValue,
  newValue,
  updateStrategy,
  secretKey: _secretKey,
}: NewEnvConfig): string {
  
  // 1️⃣ تطهير المدخلات (Sanitization) من الفراغات وعلامات التنصيص الزائدة
  const cleanCurrent = currentValue ? stripMatchingQuotes(currentValue) : "";
  const cleanNew = newValue ? stripMatchingQuotes(newValue) : "";

  // صمام أمان: لحماية المطور، إذا كانت القيمة الجديدة فارغة لا نعدل شيئاً
  if (!cleanNew) {
    return currentValue;
  }

  // إذا كانت القيم متطابقة تماماً، نرجع نفس القيمة دون تعديل
  if (cleanCurrent === cleanNew) {
    return currentValue;
  }

  // 2️⃣ تنفيذ الـ Strategy Pattern بناءً على اختيار المطور وقت الـ Runtime
  switch (updateStrategy) {
    
    // استراتيجية الاستبدال الصريح والفوري
    case "replace":
      return cleanNew;

    // استراتيجية التوسيع والحفاظ على القيمتين معاً كـ Fallback (Widen Strategy)
    case "keep-both":
      return `"${cleanCurrent}" || "${cleanNew}"`;

    // استراتيجية الدمج الذكي للبيانات (مثل دمج المصفوفات أو الروابط المكملة)
    case "merge":
      if (cleanCurrent.includes(",") || cleanNew.includes(",")) {
        // ندمج القيم ونحذف المكرر باستخدام Set لضمان نظافة الداتا
        const uniqueValues = Array.from(new Set([...cleanCurrent.split(","), ...cleanNew.split(",")]));
        return uniqueValues.filter((value): value is string => typeof value === "string").join(",");
      }
      return `${cleanCurrent};${cleanNew}`;

    default: {
      const exhaustive: never = updateStrategy;
      void exhaustive;
      return cleanNew;
    }
  }
}