// src/guard/rules/preset-rules.ts
// ✅ المصدر الموحد لكل قواعد الفحص — كل الـ engines تقرأ من هنا

export interface FieldRule {
  regex?: RegExp;
  minLength?: number;
  maxLength?: number;
  allowedValues?: readonly string[];
  customCheck?: (val: string) => boolean;
  message: string;
}

export type PresetMap = Record<string, Record<string, FieldRule>>;

export const PRESET_RULES: PresetMap = {

  // ─── APP CORE ───────────────────────────────────────────────
  app: {
    NODE_ENV: {
      allowedValues: ["development", "production", "test", "staging"],
      message: "NODE_ENV must be one of: development, production, test, staging.",
    },
    PORT: {
      customCheck: (val) => {
        const n = Number(val);
        return !isNaN(n) && Number.isInteger(n) && n >= 1024 && n <= 65535;
      },
      message: "Port must be a valid integer between 1024 and 65535.",
    },
    CORS_ORIGIN: {
      customCheck: (val) => val === "*" || val.startsWith("http://") || val.startsWith("https://"),
      message: "CORS_ORIGIN must be a valid URL (http/https) or '*'.",
    },
    LOG_LEVEL: {
      allowedValues: ["info", "warn", "error", "debug"],
      message: "LOG_LEVEL must be one of: info, warn, error, debug.",
    },
  },

  // ─── AUTHENTICATION ─────────────────────────────────────────
  auth: {
    JWT_SECRET: {
      minLength: 32,
      message: "JWT Secret must be at least 32 characters long.",
    },
    NEXTAUTH_SECRET: {
      minLength: 32,
      message: "NextAuth Secret must be at least 32 characters long.",
    },
    APP_SECRET: {
      minLength: 32,
      message: "App Secret must be at least 32 characters long.",
    },
    SESSION_SECRET: {
      minLength: 32,
      message: "Session Secret must be at least 32 characters long.",
    },
    NEXTAUTH_URL: {
      regex: /^https?:\/\//,
      message: "NEXTAUTH_URL must be a valid absolute application URL.",
    },
  },

  // ─── AWS ────────────────────────────────────────────────────
  aws: {
    AWS_ACCESS_KEY_ID: {
      regex: /^(AKIA|ASIA)[0-9A-Z]{16}$/,
      message: "AWS Access Key ID must start with AKIA/ASIA and be exactly 20 characters.",
    },
    AWS_SECRET_ACCESS_KEY: {
      regex: /^[A-Za-z0-9/+=]{40}$/,
      message: "AWS Secret Access Key must be exactly 40 base64 characters.",
    },
    AWS_REGION: {
      regex: /^[a-z]{2}-[a-z]+-\d$/,
      message: "Invalid AWS Region format (e.g., us-east-1).",
    },
    AWS_BUCKET_NAME: {
      minLength: 3,
      maxLength: 63,
      message: "AWS S3 Bucket name must be between 3 and 63 characters.",
    },
  },

  // ─── CLOUDINARY ─────────────────────────────────────────────
  cloudinary: {
    CLOUDINARY_URL: {
      regex: /^cloudinary:\/\//,
      message: "Cloudinary URL must start with 'cloudinary://'.",
    },
    CLOUDINARY_CLOUD_NAME: {
      minLength: 1,
      message: "Cloudinary Cloud Name cannot be empty.",
    },
    CLOUDINARY_API_KEY: {
      minLength: 1,
      message: "Cloudinary API Key cannot be empty.",
    },
    CLOUDINARY_API_SECRET: {
      minLength: 1,
      message: "Cloudinary API Secret cannot be empty.",
    },
  },

  // ─── SUPABASE ───────────────────────────────────────────────
  supabase: {
    SUPABASE_URL: {
      regex: /^https:\/\//,
      message: "Must be a valid secured Supabase project URL (https://...).",
    },
    SUPABASE_ANON_KEY: {
      minLength: 50,
      message: "Supabase Anon Key looks truncated or too short.",
    },
  },

  // ─── NEON / POSTGRESQL ──────────────────────────────────────
  neon: {
    DATABASE_URL: {
      regex: /^postgres(ql)?:\/\//,
      message: "Must be a valid PostgreSQL/Neon connection string (postgres:// or postgresql://).",
    },
  },
  pg: {
    PGHOST: {
      minLength: 1,
      message: "PostgreSQL Host cannot be empty.",
    },
    PGPORT: {
      customCheck: (val) => {
        const n = Number(val);
        return !isNaN(n) && n >= 1 && n <= 65535;
      },
      message: "PGPORT must be a valid integer between 1 and 65535.",
    },
    PGUSER: {
      minLength: 1,
      message: "PostgreSQL User cannot be empty.",
    },
    PGPASSWORD: {
      minLength: 1,
      message: "PostgreSQL Password cannot be empty.",
    },
    PGDATABASE: {
      minLength: 1,
      message: "PostgreSQL Database name cannot be empty.",
    },
  },

  // ─── MONGODB ────────────────────────────────────────────────
  mongodb: {
    MONGODB_URI: {
      regex: /^mongodb(\+srv)?:\/\//,
      message: "Must be a valid MongoDB connection string (mongodb:// or mongodb+srv://).",
    },
  },

  // ─── REDIS ──────────────────────────────────────────────────
  redis: {
    REDIS_URL: {
      regex: /^rediss?:\/\//,
      message: "Must be a valid Redis connection string (redis:// or rediss://).",
    },
  },

  // ─── VERCEL ─────────────────────────────────────────────────
  vercel: {
    VERCEL_ENV: {
      allowedValues: ["development", "preview", "production"],
      message: "VERCEL_ENV must be one of: development, preview, production.",
    },
  },
};

// =========================================================================
// Helper: فحص قيمة واحدة ضد rule واحدة
// كل الـ engines تستخدم هذه الدالة للتحقق — مصدر واحد للمنطق
// =========================================================================
export function validateField(_key: string, value: string, rule: FieldRule): string | null {
  if (rule.allowedValues && !rule.allowedValues.includes(value)) {
    return rule.message;
  }
  if (rule.minLength !== undefined && value.length < rule.minLength) {
    return rule.message;
  }
  if (rule.maxLength !== undefined && value.length > rule.maxLength) {
    return rule.message;
  }
  if (rule.regex && !rule.regex.test(value)) {
    return rule.message;
  }
  if (rule.customCheck && !rule.customCheck(value)) {
    return rule.message;
  }
  return null; // ✅ الحقل سليم
}

// =========================================================================
// Helper: auto-detect الـ presets من الـ env variables الموجودة
// =========================================================================
export function detectPresets(env: Record<string, string>): string[] {
  const presets = new Set<string>(["app"]);

  if (env.DATABASE_URL)                                     presets.add("neon");
  if (env.SUPABASE_URL || env.SUPABASE_ANON_KEY)           presets.add("supabase");
  if (env.AWS_ACCESS_KEY_ID || env.AWS_REGION)             presets.add("aws");
  if (env.MONGODB_URI || env.MONGODB_URL)                  presets.add("mongodb");
  if (env.REDIS_URL)                                        presets.add("redis");
  if (env.JWT_SECRET || env.NEXTAUTH_SECRET)               presets.add("auth");
  if (env.CLOUDINARY_URL || env.CLOUDINARY_CLOUD_NAME)     presets.add("cloudinary");
  if (env.PGHOST || env.PGUSER)                            presets.add("pg");
  if (env.VERCEL_ENV || env.VERCEL_URL)                    presets.add("vercel");

  return Array.from(presets);
}