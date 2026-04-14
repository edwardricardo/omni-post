/**
 * @file settingsSchemas.ts
 * @description Zod validation schemas for settings API endpoints.
 * @layer infrastructure
 */

import { z } from "zod";

const CREDENTIAL_GROUPS = [
  "STRIPE",
  "PADDLE",
  "RESEND",
  "STORAGE",
  "MONITORING",
  "AI_POOL",
  "PLATFORM",
  "SOCIAL_FACEBOOK",
  "SOCIAL_INSTAGRAM",
  "SOCIAL_X",
  "SOCIAL_YOUTUBE",
  "SOCIAL_TIKTOK",
  "SOCIAL_LINKEDIN",
  "SOCIAL_SNAPCHAT",
  "SOCIAL_TELEGRAM",
  "SOCIAL_PINTEREST",
  "SOCIAL_BLUESKY",
  "SOCIAL_THREADS",
] as const;

const AI_PROVIDERS = ["openai", "anthropic", "gemini", "perplexity"] as const;

export const credentialGroupSchema = z.enum(CREDENTIAL_GROUPS);

export const groupParamsSchema = z.object({
  group: credentialGroupSchema,
});

export const groupKeyParamsSchema = z.object({
  group: credentialGroupSchema,
  key: z.string().min(1),
});

export const updateCredentialsSchema = z.object({
  credentials: z.record(z.string().min(1), z.string().min(1)),
});

export const rotateEncryptionSchema = z.object({
  note: z.string().optional(),
});

export const setByokSchema = z.object({
  provider: z.enum(AI_PROVIDERS),
  apiKey: z.string().min(10).max(500),
});

export const byokProviderParamsSchema = z.object({
  provider: z.enum(AI_PROVIDERS),
});

export const testByokSchema = z.object({
  provider: z.enum(AI_PROVIDERS),
  apiKey: z.string().min(10).max(500),
});
