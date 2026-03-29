/**
 * Domain Layer - Read Model DTOs
 *
 * Plain TypeScript interfaces (no Prisma dependency) that mirror the shape
 * of the persisted data returned by the read-model repository ports.
 *
 * These DTOs are intentionally "flat" — they correspond 1:1 with database
 * table shapes — so that analytics, billing, and ML services can consume
 * them without any domain entity overhead.
 *
 * The Prisma adapter implementations in src/infrastructure/repositories/ are
 * responsible for mapping Prisma-generated types to these domain DTOs.
 *
 * @module domain/repositories/ReadModelDtos
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
 * Admin user roles.
 * Mirrors the Prisma `AdminRole` enum.
 * Also matches `AdminRole` from `@shared/types`.
 */
export type AdminRoleKind = "SUPER_ADMIN" | "ADMIN" | "SUPPORT";

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
  deletedAt: Date | null;
  ssoEnabled: boolean;
  ssoProvider: SsoProviderKind;
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
 * Flat DTO for a persisted AdminUser row.
 * Mirrors `Prisma.AdminUser` without the Prisma import.
 */
export interface AdminUserDto {
  id: string;
  email: string;
  passwordHash: string;
  name: string;
  role: AdminRoleKind;
  isActive: boolean;
  emailVerified: boolean;
  lastLoginAt: Date | null;
  passwordResetToken: string | null;
  passwordResetExpires: Date | null;
  mfaEnabled: boolean;
  mfaSecret: string | null;
  passwordHashAlgo: string;
  passwordChangedAt: Date;
  passwordHistory: string[];
  mustChangePassword: boolean;
  mfaBackupCodes: string[];
  mfaBackupUsedAt: JsonValue | null;
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
