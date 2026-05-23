/**
 * @file ReadModelDtos.ts
 * @description Plain TypeScript DTO interfaces for read-model repository ports — Prisma-free type mirrors that analytics, billing, and reporting services consume directly.
 * @layer domain
 */

// ---------------------------------------------------------------------------
// JSON value type (Prisma-free equivalent of Prisma.JsonValue)
// ---------------------------------------------------------------------------

/**
 * A recursive JSON-compatible value.
 * Equivalent to `Prisma.JsonValue` without the Prisma import.
 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

// ---------------------------------------------------------------------------
// Enums (mirrored from Prisma schema; kept in sync manually)
// ---------------------------------------------------------------------------

/**
 * Social media provider identifiers.
 * Mirrors the Prisma `Provider` enum.
 */
export type ProviderKind = "X" | "INSTAGRAM" | "FACEBOOK" | "YOUTUBE" | "TIKTOK";

/**
 * Subscription tier levels.
 * Mirrors the Prisma `SubscriptionTier` enum.
 */
export type SubscriptionTierKind = "BASIC" | "PRO" | "ENTERPRISE";

/**
 * Admin user roles — now DB-driven via the Role table.
 * Role names are stored as strings (e.g., "SUPER_ADMIN", "ADMIN", "SUPPORT").
 */
export type AdminRoleKind = string;

/**
 * Media asset kinds.
 * Mirrors the Prisma `MediaKind` enum.
 */
export type MediaKindValue = "image" | "video" | "gif";

/**
 * SSO provider types.
 * Mirrors the Prisma `SsoProvider` enum.
 */
export type SsoProviderKind = "NONE" | "SAML" | "OIDC";

/**
 * Payment gateway provider types.
 * Mirrors the Prisma `GatewayProvider` enum.
 */
export type GatewayProviderKind = "STRIPE" | "PADDLE";

// ---------------------------------------------------------------------------
// Core entity DTOs
// ---------------------------------------------------------------------------

/**
 * Flat DTO for a persisted Account row.
 * Mirrors `Prisma.Account` without the Prisma import.
 */
export interface AccountDto {
  id: string;
  email: string;
  name: string;
  subscription: SubscriptionTierKind;
  maxProjects: number;
  isOnTrial: boolean;
  trialStartDate: Date;
  trialEndDate: Date | null;
  autoRenewal: boolean;
  billingCycle: string;
  lastBillingDate: Date | null;
  nextBillingDate: Date | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  isActive: boolean;
  deletedAt: Date | null;
  ssoEnabled: boolean;
  ssoProvider: SsoProviderKind;
  slug: string | null;
  timezone: string;
  locale: string;
  phone: string | null;
  maxTeamMembers: number;
  maxStorageBytes: bigint;
  maxRecurringPosts: number;
  gatewayProvider: GatewayProviderKind;
  gatewayCustomerId: string | null;
  pendingGatewayProvider: GatewayProviderKind | null;
  pendingGatewaySwitch: boolean;
  gatewaySwitchAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Flat DTO for a persisted Project row.
 * Mirrors `Prisma.Project` without the Prisma import.
 */
export interface ProjectDto {
  id: string;
  name: string;
  locale: string;
  accountId: string;
  isInCrisisMode: boolean;
  crisisStartedAt: Date | null;
  crisisReason: string | null;
  crisisModeHistory: JsonValue | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Flat DTO for a persisted Post row.
 * Mirrors `Prisma.Post` without the Prisma import.
 */
export interface PostDto {
  id: string;
  projectId: string;
  status: string;
  scheduledAt: Date | null;
  publishedAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Flat DTO for a persisted PostContent row.
 * Mirrors `Prisma.PostContent` without the Prisma import.
 */
export interface PostContentDto {
  id: string;
  postId: string;
  locale: string;
  title: string | null;
  summary: string | null;
  body: string;
  tags: string[];
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Flat DTO for a persisted PostMedia row.
 * Mirrors `Prisma.PostMedia` without the Prisma import.
 */
export interface PostMediaDto {
  id: string;
  postId: string;
  url: string;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  alt: string | null;
  hash: string | null;
  type: MediaKindValue;
  createdAt: Date;
}

/**
 * Flat DTO for a persisted Channel row.
 * Mirrors `Prisma.Channel` without the Prisma import.
 */
export interface ChannelDto {
  id: string;
  projectId: string;
  provider: ProviderKind;
  handle: string;
  credentials: JsonValue;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Flat DTO for a persisted Analytics row.
 * Mirrors `Prisma.Analytics` without the Prisma import.
 */
export interface AnalyticsDto {
  id: string;
  postId: string | null;
  channelId: string;
  provider: ProviderKind;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  capturedAt: Date;
}

/**
 * Public DTO for a persisted AdminUser row — carries identity, role, status and
 * non-secret auth metadata, but NO credential material. Returned by the
 * general-purpose admin-user reads so secrets never ride the broadly-injected
 * read model. Credential-bearing reads return `AdminUserCredentialsDto`.
 */
export interface AdminUserDto {
  id: string;
  email: string;
  name: string;
  role: AdminRoleKind;
  isActive: boolean;
  emailVerified: boolean;
  lastLoginAt: Date | null;
  mfaEnabled: boolean;
  passwordHashAlgo: string;
  passwordChangedAt: Date;
  mustChangePassword: boolean;
  failedLoginAttempts: number;
  lockedUntil: Date | null;
  lockReason: string | null;
  maxConcurrentSessions: number;
  timezone: string | null;
  locale: string | null;
  department: string | null;
  team: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * `AdminUserDto` enriched with credential material (password hash, MFA secret,
 * password-reset and backup-code state). Returned ONLY by the credential-bearing
 * repository reads consumed by the authentication and MFA flows — the
 * general-purpose reads return the credential-free `AdminUserDto`.
 */
export interface AdminUserCredentialsDto extends AdminUserDto {
  passwordHash: string;
  passwordResetToken: string | null;
  passwordResetExpires: Date | null;
  mfaSecret: string | null;
  passwordHistory: string[];
  mfaBackupCodes: string[];
  mfaBackupUsedAt: JsonValue | null;
}
