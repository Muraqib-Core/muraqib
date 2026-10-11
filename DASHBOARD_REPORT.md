# تقرير تصميم لوحة التحكم (Dashboard) لـ Muraqib Core

> الحالة: **تقرير للمراجعة فقط، ولم يُكتب أي كود للتطبيق بعد.**
> الفرع: `claude/eloquent-euler-5ahgos`

## 1. ما وجدته في المشروع

- المشروع مكتبة وأداة CLI بلغة TypeScript، ولا توجد فيه أي واجهة ويب.
- يوجد عقد بيانات جاهز بصيغة JSON هو `AgentReport` في `src/agent/types.ts`. فيه الملخص حسب الخطورة وحالة كل وحدة وقائمة المشاكل.
- `collectAuditResults()` في `src/orchestrator/collect-results.ts` هي نقطة جلب نتائج الفحص، ويمكن إعادة استخدامها.
- لا يوجد في المشروع نموذج للـ **Performance Metrics** ولا للـ **Logs**. سأعرّف النموذجين من الصفر ليكونا مستقلين عن أي مصدر بيانات.
- `package.json` يعتمد على Vitest و ESLint و strict TypeScript، ولا توجد فيه أدوات bundler أو مكتبات واجهة.
- بيئة الاختبار `node` ولا يوجد `jsdom`، لذلك يجب أن تكون منطق الواجهة قابلاً للاختبار بدون DOM.

## 2. القرارات المعمارية

1. **بدون dependencies جديدة.** سأستخدم TypeScript بدون إطار عمل، ومعه ES modules يخرجها `tsc` كما هي إلى `dist/dashboard`. هذا يتوافق مع قاعدة CLAUDE.md بعدم إضافة حزم دون إذن.
2. **فصل كامل بين البيانات والعرض.** مكونات الواجهة لا تعرف شيئاً عن CLI أو عن أي registry أو عن الموبايل. تستقبل فقط `DashboardSnapshot` أو `DashboardEvent` عبر واجهة مجردة.
3. **المكونات دوال نقية.** كل widget يستقبل state ويرجع HTML نصياً بعد escaping. هذا يسهّل الاختبار بـ Vitest ويمنع ثغرات XSS من نصوص السجلات.

## 3. هيكل الملفات المقترح

```
src/dashboard/
├── core/                    # يعمل في المتصفح وفي Node، بلا DOM
│   ├── types.ts             # Metric, LogEntry, ModuleStatus, DashboardSnapshot, DashboardEvent
│   ├── store.ts             # reducer نقي + createStore (idle/loading/ready/error لكل جزء)
│   ├── selectors.ts         # فلترة السجلات، حساب الاتجاهات، حدود السجلات
│   └── sources/
│       ├── data-source.ts   # interface DashboardDataSource
│       ├── http-source.ts   # يجلب /api/snapshot عبر fetch مع polling و AbortSignal
│       ├── sse-source.ts    # بث لحظي عبر EventSource (لـ webhooks لاحقاً)
│       └── demo-source.ts   # بيانات تجريبية متحركة للتطوير
├── ui/
│   ├── widgets/             # summary-cards, metrics-grid, sparkline, modules-table, log-viewer
│   ├── layout.ts            # تسجيل الـ widgets (registry) وإضافة الجديد بسطر واحد
│   └── app.ts               # الربط مع DOM، رقيق ومستثنى من coverage
├── public/                  # index.html و styles.css (تُنسخ إلى dist أثناء build)
└── server/
    ├── server.ts            # node:http: ملفات ثابتة، GET /api/snapshot، GET /api/events (SSE)، POST /api/webhook
    └── audit-adapter.ts     # يحول نتائج الفحص الحقيقية إلى DashboardSnapshot
```

## 4. نموذج البيانات

| النوع | الحقول الأساسية |
|---|---|
| `Metric` | `id, label, unit, value, trend[{t,value}], status?, threshold?` |
| `LogEntry` | `id, ts, level (debug/info/warn/error), source, message` |
| `ModuleStatus` | `name, status (ok/issues/warning/error), issueCount, durationMs` |
| `DashboardSnapshot` | `generatedAt, project, summary, modules, metrics, logs` |
| `DashboardEvent` | `snapshot` (استبدال كامل) أو `metrics` (تحديث جزئي) أو `logs` (إضافة مع حد أقصى) |

مصدر البيانات الحقيقي المبدئي من الفحص نفسه:
- **Metrics:** مدة تنفيذ كل وحدة، وعدد المشاكل حسب الخطورة، والمدة الكلية.
- **Logs:** أحداث بدء الفحص وانتهائه، وكل issue يتحول إلى سطر سجل بمستوى مناسب.

## 5. إدارة الحالة والأداء

- لكل جزء (metrics و logs) حالة مستقلة: `idle | loading | ready | error | stale` مع `updatedAt`. فشل جزء واحد لا يكسر الباقي.
- السجلات محدودة (مثلاً 500 في الذاكرة و200 معروضة). الفلترة بالمستوى والنص تتم عبر selectors.
- لا يُعاد رسم widget إذا لم يتغير ناتجه، فيكون التحديث رخيصاً.
- شريط أدوات السجلات يُرسم مرة واحدة، فلا يفقد حقل البحث التركيز عند وصول بيانات جديدة.
- إيقاف مؤقت للتمرير التلقائي، وإلغاء الطلبات القديمة عبر AbortSignal.

## 6. الواجهة والتجاوب

- شبكة CSS Grid بـ `auto-fit`: عمود واحد على الموبايل، وعدة أعمدة على الشاشات الكبيرة.
- وضع داكن وفاتح تلقائياً (`prefers-color-scheme`).
- مخططات Sparkline بـ SVG مضمّن بدون مكتبة رسوم.
- إتاحة الوصول (accessibility): `aria-live` لحالة التحميل، وجداول دلالية، وتباين ألوان كافٍ، ولا يعتمد المعنى على اللون وحده.
- دعم RTL للنصوص العربية لاحقاً عبر logical properties في CSS.

## 7. التكامل مع API و webhooks مستقبلاً

- الواجهة لا تحتاج تعديلاً لتغيير المصدر. يكفي تمرير `DashboardDataSource` مختلف.
- `POST /api/webhook` يستقبل `DashboardEvent` من أي نظام خارجي ويبثه عبر SSE. يشترط رمزاً سرياً في الـ header، وحداً لحجم الطلب، والتحقق من الشكل قبل القبول.
- الخادم يستمع على `127.0.0.1` افتراضياً.

## 8. الاختبارات

- Vitest فقط، لكل ما يلي: reducer، selectors، escaping، كل widget، مصادر البيانات (مع fetch و EventSource وهميين)، المحول من نتائج الفحص، والخادم (ملفات ثابتة، snapshot، webhook مع رفض الرمز الخاطئ).
- الهدف أن تبقى نسبة التغطية فوق حد 85% الموجود في `vitest.config.ts`. وسأستثني `ui/app.ts` فقط لأنه ربط DOM رقيق.

## 9. التغييرات على ملفات موجودة

- `package.json`: سكربت `dashboard` وسكربت نسخ الأصول بعد `tsc`، بدون dependencies جديدة.
- `src/index.ts`: تصدير الأنواع والـ core والخادم، دون واجهة DOM.
- `vitest.config.ts`: استثناء `ui/app.ts`.
- `README.md`: قسم قصير لطريقة التشغيل.

## 10. التشغيل المتوقع

```bash
npm run build
npm run dashboard -- --path . --port 4173        # فحص حقيقي للمشروع
npm run dashboard -- --demo                       # بيانات تجريبية
```

## 11. التسليم والمخاطر

- سأعمل على الفرع `claude/eloquent-euler-5ahgos` وأقسم العمل إلى commits صغيرة (types/store، ثم sources، ثم widgets، ثم server) بحسب CLAUDE.md. لن أنشئ PR إلا إذا طلبت.
- قبل أي push سأشغل: `type-check` و `build` و `lint` و `test`.
- **مخاطر:** لا يوجد اختبار DOM حقيقي لأن jsdom غير مثبت. سأتحقق من الواجهة يدوياً بمتصفح Chromium الموجود في البيئة، وأضيف لقطة شاشة.

## 12. أسئلة تحتاج قرارك

1. هل توافق على **عدم إضافة dependencies** (بدون React/Vite)؟ هذا هو الافتراض في التقرير.
2. هل تريد أمراً `muraqib dashboard` داخل الـ CLI، أم يكفي سكربت `npm run dashboard` حالياً؟
3. هل تريد واجهة عربية RTL من البداية، أم إنجليزية الآن مع دعم RTL لاحقاً؟
