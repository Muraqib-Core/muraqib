import type { AgentSeverity } from "./types.js";

/** Text direction of a UI language. */
export type TextDirection = "ltr" | "rtl";

/** Every user-visible string of the report view. */
export interface Labels {
  lang: string;
  dir: TextDirection;
  title: string;
  runAudit: string;
  showDocs: string;
  running: string;
  verdictPass: string;
  verdictFail: string;
  auditFailed: string;
  noReport: string;
  noReportHint: string;
  noIssues: string;
  bySeverity: string;
  byModule: string;
  coverage: string;
  scanner: string;
  status: string;
  scanned: string;
  skipped: string;
  diagnostics: string;
  issues: string;
  truncated: string;
  recommendation: string;
  openFile: string;
  project: string;
  module: string;
  severity: Record<AgentSeverity, string>;
}

const EN: Labels = {
  lang: "en",
  dir: "ltr",
  title: "Muraqib audit report",
  runAudit: "Run audit",
  showDocs: "Documentation",
  running: "Audit running...",
  verdictPass: "Pass",
  verdictFail: "Fail",
  auditFailed: "The audit could not complete reliably",
  noReport: "No audit has run yet",
  noReportHint: "Run an audit to see the results here.",
  noIssues: "No issues found",
  bySeverity: "Issues by severity",
  byModule: "Issues by module",
  coverage: "Scanner coverage",
  scanner: "Scanner",
  status: "Status",
  scanned: "Scanned",
  skipped: "Skipped",
  diagnostics: "Diagnostics",
  issues: "issues",
  truncated: "more issues were hidden by the maxIssues setting",
  recommendation: "Recommendation",
  openFile: "Open",
  project: "Project",
  module: "Module",
  severity: { critical: "Critical", error: "Error", warning: "Warning", info: "Info" },
};

const AR: Labels = {
  lang: "ar",
  dir: "rtl",
  title: "تقرير تدقيق مراقب",
  runAudit: "تشغيل التدقيق",
  showDocs: "التوثيق",
  running: "جارٍ التدقيق...",
  verdictPass: "ناجح",
  verdictFail: "فاشل",
  auditFailed: "تعذّر إكمال التدقيق بشكل موثوق",
  noReport: "لم يُشغَّل أي تدقيق بعد",
  noReportHint: "شغّل التدقيق لعرض النتائج هنا.",
  noIssues: "لا توجد مشكلات",
  bySeverity: "المشكلات حسب الخطورة",
  byModule: "المشكلات حسب الوحدة",
  coverage: "تغطية الماسحات",
  scanner: "الماسح",
  status: "الحالة",
  scanned: "تم فحصه",
  skipped: "تم تخطيه",
  diagnostics: "التشخيصات",
  issues: "مشكلات",
  truncated: "مشكلات إضافية أُخفيت بسبب إعداد maxIssues",
  recommendation: "التوصية",
  openFile: "فتح",
  project: "المشروع",
  module: "الوحدة",
  severity: { critical: "حرجة", error: "خطأ", warning: "تحذير", info: "معلومة" },
};

/** Pick labels for a VS Code language tag such as `ar`, `ar-SA` or `en-US`; falls back to English. */
export function getLabels(language: string | undefined): Labels {
  const primary = (language ?? "en").toLowerCase().split(/[-_]/)[0];
  return primary === "ar" ? AR : EN;
}
