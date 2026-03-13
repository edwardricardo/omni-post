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
  | "BLUESKY";
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
  | "bluesky";

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
 * Maps database subscription tier to application SubscriptionTier
 */
export function mapSubscriptionTierFromDB(tier: PrismaSubscriptionTier): SubscriptionTier {
  return tier as SubscriptionTier;
}

/**
 * Maps application SubscriptionTier to database subscription tier
 */
export function mapSubscriptionTierToDB(tier: SubscriptionTier): PrismaSubscriptionTier {
  return tier as PrismaSubscriptionTier;
}

/**
 * Returns the maximum number of projects allowed for a subscription tier
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
export function mapThreadStrategyFromDB(strategy: any): any {
  return strategy;
}

/**
 * Maps application thread strategy to database type
 */
export function mapThreadStrategyToDB(strategy: any): any {
  return strategy;
}

/**
 * Maps database tweet status to application type
 */
export function mapTweetStatusFromDB(status: any): any {
  return status;
}

/**
 * Maps application tweet status to database type
 */
export function mapTweetStatusToDB(status: any): any {
  return status;
}
