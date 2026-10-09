# 🛡️ CLAUDE.md — Muraqib Core Integration Guidelines

> **مرجع شامل** للعمل على مشروع Muraqib Core. يجب الالتزام الكامل بهذه القوانين.

---

## 1️⃣ Branching & Git Workflow (قوانين الفروع)

### Branch Management
- **ممنوع تماماً** الكتابة مباشرة على `main` — جميع العمل يكون على فروع مستقلة.
- **أسماء الفروع**: استخدم البادئات التالية:
  - `feat/` للميزات الجديدة (`feat/config-validation`)
  - `fix/` للإصلاحات (`fix/ci-cd-npm-install`)
  - `refactor/` لإعادة الهيكلة
  - `docs/` للتوثيق فقط
  - `merge/` لدمج من مستودع آخر

### Commit & Push Rules
- اكتب رسائل Commit واضحة بصيغة imperative: `"fix: resolve npm ci failure"` ليس `"fixed npm ci"`
- في كل commit، أضف سطر attribution:
  ```
  Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_...
  ```
- اجعل الـ commits صغيرة ومركزة على موضوع واحد (Atomic Commits).
- **اجعل جميع الـ commits مباشرة** — لا تعدل commits محمرة أو مدمجة.

### Pull Requests & Merging
- قبل الـ PR: **تأكد من نجاح CI/CD محلياً** و100% من الاختبارات تمر.
- وصف الـ PR يجب أن يشرح **المشكلة** و**الحل** و**الاختبار** المتبع.
- بعد الـ PR approval و CI/CD green: **استخدم "Squash & Merge"** لتبسيط التاريخ.
- الـ main branch هو **production-ready دائماً** — لا تدمج إلا ما هو مكتمل و مختبر.

---

## 2️⃣ Dual-Repository Integration (استراتيجية الدمج)

### Repository Sources
1. **Primary (Muraqib Core)**: `https://github.com/Ayaalmadhon2004/-Muraqib-Core`
   - النواة الأساسية، Guard implementations، التوثيق
2. **Secondary (Partner Repository)**: ميزات إضافية، AI integrations، UI improvements

### Merge Strategy
- عند جلب code من مستودع آخر:
  1. **اقرأ وافهم الكود بالكامل** قبل نقله
  2. **تجنب التكرار** — دمج مع الكود الموجود بدل النسخ
  3. **وحد الأنماط** — استخدم نفس architecture (BaseGuard, AuditResult, إلخ)
  4. **اكتب اختبارات** للكود الجديد قبل الدمج
- **ممنوع** الدمج الأعمى أو البطري — دائماً review و verify

---

## 3️⃣ Strict TypeScript & Code Quality (قوانين TypeScript الصارمة)

### TypeScript Settings (tsconfig.json)
```json
{
  "strict": true,
  "noImplicitAny": true,
  "noUnusedLocals": true,
  "noUnusedParameters": true,
  "noUncheckedIndexedAccess": true,
  "exactOptionalPropertyTypes": true,
  "noImplicitThis": true,
  "alwaysStrict": true
}
```

### Code Standards
- **ممنوع `any`** نهائياً — استخدم `unknown` مع Type Guards أو `as const` للضرورة
- **Return Types**: كل دالة عامة يجب أن تحدد return type بوضوح
  ```typescript
  export async function audit(): Promise<AuditResult> { ... }  // ✓ صحيح
  export async function audit() { ... }  // ✗ خطأ
  ```
- **Null Safety**: استخدم `const x = value ?? defaultValue` وليس `||`
- **No Optional Catch**: استخدم `catch` بدون متغير أو عدّل الكود للتعامل مع الخطأ

### Linting & Formatting
- **ESLint must pass**: `npm run lint` يجب أن يكون green قبل أي commit
- **إذا كان 4 warnings فقط** عن `any` type: قبول مؤقت مع TODO comment
- **Auto-fix available**: استخدم `npm run lint -- --fix` للإصلاح التلقائي

---

## 4️⃣ CI/CD & Testing Requirements

### Before Any Push
```bash
npm run type-check    # TypeScript strict check
npm run build         # Verify compilation
npm run lint          # ESLint compliance
npm test              # All tests must pass
```

### package.json & Dependencies
- **package-lock.json MUST be committed** — عدم وجوده يسبب فشل CI/CD
- إذا أضفت dependency جديد: اشتغل `npm install` و commit الـ lock file
- لا تحدّث packages بدون سبب — اطلب إذن أولاً

### Test Coverage Targets
- **Minimum 85%**: استهدف 85% coverage على الأقل
- **كل ميزة جديدة = اختبارات جديدة** — لا incremental features بدون tests
- استخدم **Vitest** فقط (`npm test`)، لا Jest أو أي framework تاني

---

## 5️⃣ Code Architecture Rules (قوانين العمارة)

### Guard Pattern (Mandatory)
- كل guard/auditor يجب أن يمتد من `BaseGuard`:
  ```typescript
  export class MyGuard extends BaseGuard {
    async execute(context: AuditContext): Promise<AuditResult> {
      // implementation
    }
  }
  ```
- لا تستخدم الدوال المنفردة الوحيدة (Standalone Functions) للـ audits الجديدة

### File Organization
```
src/
├── index.ts              # Public API exports only
├── core/
│   ├── types.ts          # Unified types
│   ├── base-guard.ts     # Abstract base class
│   └── *-guard.ts        # Guard implementations
├── env/                  # Environment validation
├── cli/                  # CLI interface
└── utils/                # Utilities
```

### Import Rules
- استخدم `import type { ... } from '...'` للـ types فقط
- لا تستورد `index.ts` من ملفات فيه
- استخدم `export { ... }` فقط في `index.ts`

---

## 6️⃣ Execution Guardrails (تعليمات لـ Claude)

### Forbidden Actions
- ❌ حذف أو تدمير ملفات بدون إذن صريح
- ❌ تشغيل `git reset --hard` أو `git checkout -- .`
- ❌ إعادة كتابة التاريخ (rebase محمرة) على `main`
- ❌ تعطيل الاختبارات أو تخطيها

### Required Verifications
- ✅ قبل أي PR: تأكد من **CI/CD green محلياً**
- ✅ قبل الدمج: اقرأ الـ diff كاملاً وتأكد من الصحة
- ✅ بعد الدمج: تحقق من GitHub Actions و تأكد من نجاح Pipeline

### Documentation
- لكل ميزة جديدة: أضف JSDoc comments
- لكل Guard جديد: وثق الـ purpose و الـ severity levels
- لا تترك TODO comments مفتوحة في الـ production code

---

## 7️⃣ Emergency Recovery (في حالة الأزمات)

### If CI/CD Breaks
1. تحقق من آخر run على GitHub Actions
2. شغّل `npm ci && npm run build && npm test` محلياً لـ reproduce
3. إذا فشل محلياً: اكتشف السبب و حل في branch جديد
4. لا تسحب من `main` إذا كانت حمراء

### If Merge Conflict
- استخدم `git merge origin/main` و حل يدوياً
- في الصراع: اختر ما هو **أحدث و أصح** (اسأل إذا لم تكن متأكد)
- بعد الحل: اشتغل الـ tests مرة أخرى للتأكد

---

**آخر تحديث**: 2026-10-09 | **Version**: 1.0
