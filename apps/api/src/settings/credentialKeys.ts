/**
 * @file credentialKeys.ts
 * @description Defines the expected credential keys for each CredentialGroup.
 *   Used for validation, masking, and UI rendering in the settings pages.
 * @layer application
 */

import type { CredentialGroup } from "@infra/prisma";

/**
 * Expected keys for each credential group. Acts as a whitelist —
 * setGroupSettings rejects any key not listed here.
 */
export const CREDENTIAL_KEYS: Record<CredentialGroup, string[]> = {
  STRIPE: [
    "secretKey",
    "webhookSecret",
    "priceStarterMonthly",
    "priceStarterYearly",
    "priceProMonthly",
    "priceProYearly",
    "sandboxMode",
  ],
  PADDLE: [
    "apiKey",
    "webhookSecret",
    "priceStarterMonthly",
    "priceStarterYearly",
    "priceProMonthly",
    "priceProYearly",
    "sandboxMode",
  ],
  RESEND: ["apiKey", "fromEmail", "fromName", "replyTo"],
  STORAGE: ["provider", "accessKeyId", "secretAccessKey", "bucketName", "region", "endpoint"],
  MONITORING: ["sentryDsn", "sentryEnvironment", "sentryTracesSampleRate"],
  AI_POOL: [
    "openaiApiKey",
    "openaiModel",
    "anthropicApiKey",
    "anthropicModel",
    "geminiApiKey",
    "geminiModel",
    "perplexityApiKey",
    "perplexityModel",
    "defaultProvider",
    "monthlyTokenBudget",
  ],
  PLATFORM: [
    "name",
    "logoUrl",
    "faviconUrl",
    "supportEmail",
    "baseUrl",
    "adminUrl",
    "timezone",
    "defaultLanguage",
    "turnstileSiteKey",
    "turnstileSecretKey",
  ],
  SOCIAL_FACEBOOK: ["appId", "appSecret", "accessToken"],
  SOCIAL_INSTAGRAM: ["appId", "appSecret", "accessToken"],
  SOCIAL_X: ["apiKey", "apiSecret", "accessToken", "accessTokenSecret"],
  SOCIAL_YOUTUBE: ["clientId", "clientSecret", "accessToken"],
  SOCIAL_TIKTOK: ["clientId", "clientSecret", "accessToken", "analyticsApiKey", "researchApiKey"],
  SOCIAL_LINKEDIN: ["clientId", "clientSecret", "accessToken"],
  SOCIAL_SNAPCHAT: ["clientId", "clientSecret", "accessToken"],
  SOCIAL_TELEGRAM: ["botToken"],
  SOCIAL_PINTEREST: ["appId", "appSecret", "accessToken"],
  SOCIAL_BLUESKY: ["identifier", "appPassword"],
  SOCIAL_THREADS: ["accessToken"],
};

/**
 * Keys whose values are not secrets and should be returned in plaintext.
 * All other keys are masked in GET responses.
 */
export const NON_SECRET_KEYS = new Set([
  "sandboxMode",
  "provider",
  "fromName",
  "replyTo",
  "bucketName",
  "region",
  "endpoint",
  "sentryEnvironment",
  "sentryTracesSampleRate",
  "openaiModel",
  "anthropicModel",
  "geminiModel",
  "perplexityModel",
  "defaultProvider",
  "monthlyTokenBudget",
  "name",
  "logoUrl",
  "faviconUrl",
  "supportEmail",
  "baseUrl",
  "adminUrl",
  "timezone",
  "defaultLanguage",
  "turnstileSiteKey",
  "identifier",
]);
