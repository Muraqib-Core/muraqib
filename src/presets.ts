// src/presets.ts
import { z } from "zod";

export interface VercelEnv {
  VERCEL?: string;
  CI?: string;
  VERCEL_ENV?: "development" | "preview" | "production";
  VERCEL_TARGET_ENV?: "development" | "preview" | "production" | (string & {});
  VERCEL_URL?: string;
  VERCEL_PROJECT_PRODUCTION_URL?: string;
  VERCEL_BRANCH_URL?: string;
  VERCEL_REGION?: string;
  VERCEL_DEPLOYMENT_ID?: string;
}

export interface NeonVercelEnv extends VercelEnv {
  DATABASE_URL: string;
  DATABASE_URL_UNPOOLED?: string;
  PGHOST?: string;
  PGHOST_UNPOOLED?: string;
}

export interface SupabaseVercelEnv extends VercelEnv { // muraqib-ignore-dead: auto-suppressed by script for SupabaseVercelEnv
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
}

export interface RailwayEnv { // muraqib-ignore-dead: auto-suppressed by script for RailwayEnv
  RAILWAY_ENVIRONMENT_NAME?: string;
  RAILWAY_ENVIRONMENT_ID?: string;
  RAILWAY_PROJECT_NAME?: string;
  RAILWAY_PROJECT_ID?: string;
}

export type PresetInput = "vercel" | "neonVercel" | "supabaseVercel" | "railway" | "next"; 

export const presetsMap: Record<PresetInput, Record<string, z.ZodTypeAny>> = {
  vercel: {
    VERCEL: z.string().optional(),
    VERCEL_ENV: z.enum(["development", "preview", "production"]).optional(),
  },
  next: {
    NEXT_PUBLIC_APP_URL: z.string().url().optional(), 
  },
  neonVercel: {
    DATABASE_URL: z.string().url(),
  },
  supabaseVercel: {
    SUPABASE_URL: z.string().url(),
    SUPABASE_ANON_KEY: z.string(),
  },
  railway: {
    RAILWAY_ENVIRONMENT_NAME: z.string().optional(),
  }
};