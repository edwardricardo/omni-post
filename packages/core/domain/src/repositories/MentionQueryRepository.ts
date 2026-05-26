/**
 * @file MentionQueryRepository.ts
 * @description Read-model query repository port for the brand-listening corpus.
 *   Returns flat DTOs (CQRS read side) for the mention feed and computes Share
 *   of Voice over the normalized corpus. SoV is `mentions_marca / mentions_mercado`
 *   where marca = BRAND-attributed or own-brand (webhook) mentions and mercado =
 *   MARKET-attributed mentions.
 * @layer domain
 */

import { type ProviderType } from "../value-objects/Provider.js";
import {
  type CursorPagination,
  type CursorPaginatedResult,
} from "./SocialMessageQueryRepository.js";

export type { CursorPagination, CursorPaginatedResult };

/** Tracked-term classification driving Share of Voice. */
export type TrackedTermKindValue = "BRAND" | "MARKET";

/** Sentiment label assigned by the (decoupled) enrichment step. */
export type MentionSentimentValue = "POSITIVE" | "NEUTRAL" | "NEGATIVE";

/**
 * DTO for a single brand mention in the listening feed.
 */
export interface MentionDTO {
  id: string;
  accountId: string;
  projectId: string;
  provider: string;
  externalId: string;
  source: string;
  trackedTermId: string | null;
  trackedTermKind: string | null;
  channelId: string | null;
  authorName: string;
  authorHandle: string | null;
  authorAvatarUrl: string | null;
  authorProviderId: string;
  url: string | null;
  body: string;
  lang: string | null;
  mediaUrls: string[];
  /** Sentiment score in [-1, 1]; null until enrichment runs. */
  sentimentScore: number | null;
  /** Sentiment label; null until enrichment runs. */
  sentimentLabel: string | null;
  providerCreatedAt: Date;
  ingestedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Filter criteria for the mention feed query.
 */
export interface MentionFilter {
  accountId: string;
  projectId?: string;
  provider?: ProviderType;
  kind?: TrackedTermKindValue;
  sentiment?: MentionSentimentValue;
  since?: Date;
  until?: Date;
}

/**
 * Per-provider Share of Voice breakdown.
 */
export interface ProviderShareDTO {
  provider: string;
  brandCount: number;
  marketCount: number;
  totalCount: number;
  sov: number;
}

/**
 * Mention counts grouped by sentiment label (unscored = not yet enriched).
 */
export interface SentimentBreakdownDTO {
  positive: number;
  neutral: number;
  negative: number;
  unscored: number;
}

/**
 * Share of Voice over a time window, computed from the normalized corpus.
 * `sov = brandCount / marketCount` (0 when marketCount is 0). Raw counts are
 * exposed so consumers can derive alternative ratios.
 */
export interface ShareOfVoiceDTO {
  projectId: string;
  since: Date;
  until: Date;
  brandCount: number;
  marketCount: number;
  totalCount: number;
  sov: number;
  byProvider: ProviderShareDTO[];
  bySentiment: SentimentBreakdownDTO;
}

/**
 * @interface MentionQueryRepository
 * @description Read-model port for the brand-listening corpus: a cursor-paginated
 *   mention feed and a windowed Share-of-Voice aggregation.
 */
export interface MentionQueryRepository {
  /**
   * @method getShareOfVoice
   * @description Compute Share of Voice for a project over a window from the
   *   normalized corpus (single consistent source, no per-platform divergence).
   * @param params - Account + project scope and the [since, until) window.
   * @returns Aggregated counts, sov ratio, and per-provider / per-sentiment breakdowns.
   */
  getShareOfVoice(params: {
    accountId: string;
    projectId: string;
    since: Date;
    until: Date;
  }): Promise<ShareOfVoiceDTO>;

  /**
   * @method listMentions
   * @description Cursor-paginated mention feed with optional filters.
   * @param filter - Account-scoped filter criteria.
   * @param pagination - Cursor-based pagination options.
   * @returns Paginated list of mention DTOs.
   */
  listMentions(
    filter: MentionFilter,
    pagination: CursorPagination
  ): Promise<CursorPaginatedResult<MentionDTO>>;
}
