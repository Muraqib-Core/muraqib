import type { FixClass } from "../types.js";
import type { ExplainLang } from "./config.js";

/** Deterministic explanations used when no LLM is available. Same plan, no key needed. */
const TEMPLATES: Record<ExplainLang, Record<FixClass, string>> = {
  en: {
    "floating-promise":
      "A promise is started but never awaited, so failures are silently lost. Add `await` (or `.catch()`) so errors are handled.",
    "hardcoded-secret":
      "A secret is written in source code and ends up in version control. Move it to an environment variable and rotate the exposed value.",
    "env-documentation":
      "The code reads an environment variable that .env.example does not mention. Add it there with a placeholder value.",
    manual: "Muraqib has no automatic fix for this one. Follow the recommendation in the audit report.",
  },
  ar: {
    "floating-promise":
      "تم بدء promise بدون await، فأي فشل فيها يضيع بصمت. أضف `await` أو `.catch()` حتى تُعالَج الأخطاء.",
    "hardcoded-secret":
      "سرّ مكتوب داخل الكود ويصل إلى نظام التحكم بالإصدارات. انقله إلى متغير بيئة وجدّد القيمة المكشوفة.",
    "env-documentation":
      "الكود يقرأ متغير بيئة غير مذكور في ملف .env.example. أضفه هناك بقيمة افتراضية بديلة.",
    manual: "لا يوجد إصلاح تلقائي لهذه المشكلة. اتبع التوصية الواردة في تقرير الفحص.",
  },
};

/** Static explanation for a fix class in the requested language. */
export function templateExplanation(fixClass: FixClass, lang: ExplainLang): string {
  return TEMPLATES[lang][fixClass];
}
