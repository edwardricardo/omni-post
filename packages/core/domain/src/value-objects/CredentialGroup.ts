/**
 * @file CredentialGroup.ts
 * @description Domain value object enumerating the credential categories used
 *   by `PlatformCredentialService`. Decouples application code from the
 *   Prisma-generated enum. String values match the Prisma enum exactly so they
 *   pass structural type-checks at adapter boundaries (no mapper required,
 *   unlike `Provider`'s lowercase/uppercase split).
 * @layer domain
 */

export const CREDENTIAL_GROUPS = {
  STRIPE: "STRIPE",
  PADDLE: "PADDLE",
  RESEND: "RESEND",
  STORAGE: "STORAGE",
  MONITORING: "MONITORING",
  AI_POOL: "AI_POOL",
  PLATFORM: "PLATFORM",
  SOCIAL_FACEBOOK: "SOCIAL_FACEBOOK",
  SOCIAL_INSTAGRAM: "SOCIAL_INSTAGRAM",
  SOCIAL_X: "SOCIAL_X",
  SOCIAL_YOUTUBE: "SOCIAL_YOUTUBE",
  SOCIAL_TIKTOK: "SOCIAL_TIKTOK",
  SOCIAL_LINKEDIN: "SOCIAL_LINKEDIN",
  SOCIAL_SNAPCHAT: "SOCIAL_SNAPCHAT",
  SOCIAL_TELEGRAM: "SOCIAL_TELEGRAM",
  SOCIAL_PINTEREST: "SOCIAL_PINTEREST",
  SOCIAL_BLUESKY: "SOCIAL_BLUESKY",
  SOCIAL_THREADS: "SOCIAL_THREADS",
} as const;

export type CredentialGroup = (typeof CREDENTIAL_GROUPS)[keyof typeof CREDENTIAL_GROUPS];
