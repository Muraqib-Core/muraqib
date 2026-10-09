/**
 * @file env-options.ts
 * @description خريطة بأسماء متغيرات البيئة الخاصة بـ Muraqib نفسه (وليست متغيرات مشروع المستخدم).
 * توضح هذه الخريطة أي من هذه المتغيرات يعتبر حسناً (سراً) وأيها غير حساس،
 * وتُستخدم من قبل core/config-guard.ts للتحقق من عدم تسريب أي مفاتيح حساسة
 * ضمن ملفات الـ .env الخاصة بمشروع المستخدم.
 */
export interface MuraqibOptionInfo { // muraqib-ignore-dead: auto-suppressed by script for MuraqibOptionInfo
  configName: string;
  type: "string" | "number" | "boolean";
  isSensitive: boolean;
}

interface MuraqibOptionDefinition {
  name: string;
  type: MuraqibOptionInfo["type"];
  isSensitive: boolean;
}

const muraqibOptions: MuraqibOptionDefinition[] = [
  { name: "dbUrl", type: "string", isSensitive: true },
  { name: "allowEmpty", type: "boolean", isSensitive: false },
  { name: "serverPort", type: "number", isSensitive: false },
];


function toEnvKey(optionName: string): string {
  return `MURAQIB_${optionName.replace(/([A-Z])/g, "_$1").toUpperCase()}`;
}
 // muraqib-ignore-dead: auto-suppressed by script for getMuraqibEnvMap
export function getMuraqibEnvMap(): Record<string, MuraqibOptionInfo> {
  const map: Record<string, MuraqibOptionInfo> = {};

  for (const option of muraqibOptions) {
    map[toEnvKey(option.name)] = {
      configName: option.name,
      type: option.type,
      isSensitive: option.isSensitive,
    };
  }

  return map;
}

export function getSensitiveMuraqibEnvKeys(): string[] {
  return Object.entries(getMuraqibEnvMap())
    .filter(([, info]) => info.isSensitive)
    .map(([envKey]) => envKey);
}