/**
 * @file TrendRadarResultPort.ts
 * @description Application-layer port for persisting scored trend-radar rows.
 *              The Prisma adapter sits behind this contract so the
 *              orchestrator (`DetectTrendsUseCase`) stays framework-free.
 *              Provider / source / urgency are carried as string literal
 *              unions; the adapter narrows them to Prisma enums on write.
 * @layer application
 */

import type { TrendSource } from "./FetchTrendingTopicsUseCase.js";

export type TrendRadarProvider =
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

export type TrendRadarSourceEnum = "PERPLEXITY_WEB" | "ACCOUNT_ANALYTICS" | "INBOX_MENTIONS";

export type TrendRadarUrgency = "NOW" | "TODAY" | "THIS_WEEK";

export interface TrendRadarRow {
  topic: string;
  platform: TrendRadarProvider;
  source: TrendRadarSourceEnum;
  sourceUrl: string | null;
  relevanceScore: number;
  postIdea: string | null;
  bestPlatform: TrendRadarProvider | null;
  urgency: TrendRadarUrgency;
  volume: number | null;
}

export interface TrendRadarUpsertInput {
  accountId: string;
  fetchedAt: Date;
  trends: ReadonlyArray<TrendRadarRow>;
}

export interface TrendRadarUpsertOutput {
  persisted: number;
  updated: number;
}

export interface TrendRadarResultPort {
  upsert(input: TrendRadarUpsertInput): Promise<TrendRadarUpsertOutput>;
}

export const TREND_RADAR_PROVIDERS: ReadonlySet<TrendRadarProvider> = new Set<TrendRadarProvider>([
  "X",
  "INSTAGRAM",
  "FACEBOOK",
  "YOUTUBE",
  "TIKTOK",
  "SNAPCHAT",
  "TELEGRAM",
  "PINTEREST",
  "LINKEDIN",
  "BLUESKY",
  "THREADS",
]);

export const TREND_SOURCE_TO_ENUM: Record<TrendSource, TrendRadarSourceEnum> = {
  "perplexity-web": "PERPLEXITY_WEB",
  "account-analytics": "ACCOUNT_ANALYTICS",
  "inbox-mentions": "INBOX_MENTIONS",
};
