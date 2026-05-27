/**
 * @file AiTokenUsageReader.ts
 * @description Read-only port over the `AiTokenUsage` model. Lets
 *   application-layer services (e.g. `SettingsService`) compute monthly
 *   AI-budget usage without coupling to Prisma. Writes (token-usage
 *   accounting) live on a separate port that will be introduced when
 *   `AiRequestService` is migrated to @core.
 *
 *   Port-level error type is a string union (canon for @core/domain
 *   repository ports — see `AccountQueryRepository`, `AIServicePort`).
 * @layer domain
 */

import { type Result } from "@shared/types";

/** Failure modes for AI-token-usage reads. */
export type AiTokenUsageReadError = "DATABASE_ERROR";

export interface AiTokenUsageReader {
  /**
   * Sum the `tokensUsed` field across rows for the given account whose
   * `usedAt` falls inside the current calendar month (in the server's
   * local timezone — the same window used by the rate-limit reset
   * computation).
   *
   * @param accountId - Account whose usage is being aggregated.
   * @param includeByok - When `false`, excludes BYOK-flagged usage from
   *   the sum (matches the "platform-pool budget" UX). When `true`,
   *   includes every row.
   */
  sumTokensThisMonth(
    accountId: string,
    includeByok: boolean
  ): Promise<Result<number, AiTokenUsageReadError>>;
}
