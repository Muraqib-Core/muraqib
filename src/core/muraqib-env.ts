export type EnvUpdateStrategy = 'replace' | 'keep-both' | 'merge'; // muraqib-ignore-dead: auto-suppressed by script for EnvUpdateStrategy

export interface NewEnvConfig { // muraqib-ignore-dead: auto-suppressed by script for NewEnvConfig
  currentValue: string;          // القيمة القديمة من ملف الـ .env الحالي
  newValue: string;              // القيمة الجديدة المراد تحديثها
  updateStrategy: EnvUpdateStrategy; // الاستراتيجية المختارة للتحديث
  secretKey?: string;             // اسم المتغير (مثال: DATABASE_URL)
}

/**
 * دالة Muraqib لتطهير وصياغة قيم متغيرات البيئة بناءً على استراتيجيات هندسية مرنة
 */
export function getNewEnvValue({ // muraqib-ignore-dead: auto-suppressed by script for getNewEnvValue
  currentValue,
  newValue,
  updateStrategy,
  secretKey: _secretKey,
}: NewEnvConfig): string | null {
  
  // 1️⃣ تطهير المدخلات (Sanitization) من الفراغات وعلامات التنصيص الزائدة
  const cleanCurrent = currentValue ? currentValue.trim().replace(/^["']|["']$/g, '') : '';
  const cleanNew = newValue ? newValue.trim().replace(/^["']|["']$/g, '') : '';

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
    case 'replace':
      return cleanNew;

    // استراتيجية التوسيع والحفاظ على القيمتين معاً كـ Fallback (Widen Strategy)
    case 'keep-both':
      return `"${cleanCurrent}" || "${cleanNew}"`;

    // استراتيجية الدمج الذكي للبيانات (مثل دمج المصفوفات أو الروابط المكملة)
    case 'merge':
      if (cleanCurrent.includes(',') || cleanNew.includes(',')) {
        // ندمج القيم ونحذف المكرر باستخدام Set لضمان نظافة الداتا
        const uniqueValues = Array.from(new Set([...cleanCurrent.split(','), ...cleanNew.split(',')]));
        return uniqueValues.filter((value): value is string => typeof value === 'string').join(',');
      }
      return `${cleanCurrent};${cleanNew}`;
// muraqib-unreachable: flagged by automated triage. Review before removal.

    default:
      return cleanNew;
  }
}