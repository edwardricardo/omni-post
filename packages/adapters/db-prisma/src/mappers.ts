import type { SubscriptionTier } from "@shared/types";

// Database type definitions
export type Provider =
  | "X"
  | "INSTAGRAM"
  | "FACEBOOK"
  | "YOUTUBE"
  | "TIKTOK"
  | "SNAPCHAT"
  | "TELEGRAM"
  | "PINTEREST"
  | "LINKEDIN"
  | "BLUESKY"
  | "THREADS";
export type PrismaSubscriptionTier = "BASIC" | "PRO" | "ENTERPRISE";
export type PrismaThreadStrategy = "SEQUENTIAL" | "INSTANT" | "BATCH";
export type PrismaTweetStatus = "PENDING" | "PUBLISHED" | "FAILED";

type AppProvider =
  | "x"
  | "instagram"
  | "facebook"
  | "youtube"
  | "tiktok"
  | "snapchat"
  | "telegram"
  | "pinterest"
  | "linkedin"
  | "bluesky"
  | "threads";

/**
 * Maps database Provider enum to application provider string
 */
export function mapProviderFromDB(provider: Provider): AppProvider {
  return provider.toLowerCase() as AppProvider;
}

/**
 * Maps application provider string to database Provider enum
 */
export function mapProviderToDB(provider: AppProvider): Provider {
  return provider.toUpperCase() as Provider;
}

/**
 * @deprecated SubscriptionTier mapping no longer needed with AccountSubscription model.
 */
export function mapSubscriptionTierFromDB(tier: PrismaSubscriptionTier): SubscriptionTier {
  return tier as SubscriptionTier;
}

/**
 * @deprecated SubscriptionTier mapping no longer needed with AccountSubscription model.
 */
export function mapSubscriptionTierToDB(tier: SubscriptionTier): PrismaSubscriptionTier {
  return tier as PrismaSubscriptionTier;
}

/**
 * @deprecated Use AccountSubscription.maxProjects instead.
 */
export function getMaxProjectsForTier(tier: SubscriptionTier): number {
  switch (tier) {
    case "BASIC":
      return 1;
    case "PRO":
      return 3;
    case "ENTERPRISE":
      return 5;
    default:
      return 1;
  }
}

/**
 * Maps database thread strategy to application type
 */
export function mapThreadStrategyFromDB<T extends string>(strategy: T): T {
  return strategy;
}

/**
 * Maps application thread strategy to database type
 */
export function mapThreadStrategyToDB<T extends string>(strategy: T): T {
  return strategy;
}

/**
 * Maps database tweet status to application type
 */
export function mapTweetStatusFromDB<T extends string>(status: T): T {
  return status;
}

/**
 * Maps application tweet status to database type
 */
export function mapTweetStatusToDB<T extends string>(status: T): T {
  return status;
}
