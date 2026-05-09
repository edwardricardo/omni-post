/**
 * @file constants.ts
 * @description Frontend mirror of credential group keys and non-secret field set.
 *   Used by CredentialForm and tab components to build field definitions.
 * @layer infrastructure
 */

export interface FieldDef {
  key: string;
  label: string;
  isSecret: boolean;
}

const CREDENTIAL_KEYS: Record<string, string[]> = {
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

const NON_SECRET_KEYS = new Set([
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

/** Social provider groups in display order */
export const SOCIAL_GROUPS = [
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

/** Tab key to credential group(s) mapping for overview navigation */
export const TAB_GROUP_MAP: Record<string, string[]> = {
  gateways: ["STRIPE", "PADDLE"],
  email: ["RESEND"],
  ai: ["AI_POOL"],
  storage: ["STORAGE"],
  platform: ["PLATFORM"],
  monitoring: ["MONITORING"],
  social: [...SOCIAL_GROUPS],
};

/**
 * @function buildFieldDefs
 * @description Builds FieldDef array for a credential group using i18n labels.
 * @param group - Credential group key
 * @param t - Translation function scoped to "settings"
 * @returns Array of field definitions with label and secret flag
 */
export function buildFieldDefs(group: string, t: (key: string) => string): FieldDef[] {
  return (CREDENTIAL_KEYS[group] ?? []).map((key) => ({
    key,
    label: t(`fields.${key}`),
    isSecret: !NON_SECRET_KEYS.has(key),
  }));
}
