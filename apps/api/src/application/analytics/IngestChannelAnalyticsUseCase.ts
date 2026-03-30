/**
 * @file IngestChannelAnalyticsUseCase.ts
 * @description Fetches analytics from a provider adapter for a single channel
 *              and upserts the results into AnalyticsDailySummary.
 *              Called by the analytics ingestion worker (one job per channel).
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import type { ChannelRepository } from "../../domain/repositories/ChannelRepository.js";
import type { AnalyticsWriteRepository } from "../../domain/repositories/AnalyticsWriteRepository.js";
import type { UnitOfWork } from "../../domain/repositories/Repository.js";
import type { ProviderAdapter } from "@ports/core";

export interface IngestChannelAnalyticsInput {
  channelId: string;
  accountId: string;
  since?: Date;
}

export interface IngestChannelAnalyticsOutput {
  ingested: number;
  channelId: string;
}

export const INGEST_ERRORS = {
  CHANNEL_NOT_FOUND: "CHANNEL_NOT_FOUND",
  AUTH_ERROR: "AUTH_ERROR",
  RATE_LIMITED: "RATE_LIMITED",
  PROVIDER_ERROR: "PROVIDER_ERROR",
  ANALYTICS_NOT_SUPPORTED: "ANALYTICS_NOT_SUPPORTED",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

export class IngestChannelAnalyticsError extends Error {
  public readonly code: (typeof INGEST_ERRORS)[keyof typeof INGEST_ERRORS];

  constructor(
    message: string,
    code: (typeof INGEST_ERRORS)[keyof typeof INGEST_ERRORS],
    cause?: Error
  ) {
    super(message, { cause });
    this.name = "IngestChannelAnalyticsError";
    this.code = code;
  }
}

export class IngestChannelAnalyticsUseCase {
  constructor(
    private readonly channelRepository: ChannelRepository,
    private readonly analyticsWriteRepository: AnalyticsWriteRepository,
    private readonly getProviderAdapter: (provider: string) => ProviderAdapter | undefined,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  async execute(
    input: IngestChannelAnalyticsInput
  ): Promise<Result<IngestChannelAnalyticsOutput, IngestChannelAnalyticsError>> {
    const channelResult = await this.channelRepository.findById({
      value: input.channelId,
    } as import("../../domain/value-objects/EntityId.js").ChannelId);
    if (!channelResult.ok) {
      return err(
        new IngestChannelAnalyticsError(
          `Channel ${input.channelId} not found`,
          INGEST_ERRORS.CHANNEL_NOT_FOUND
        )
      );
    }

    const channel = channelResult.value;
    const providerName = channel.provider.toString().toLowerCase();
    const adapter = this.getProviderAdapter(providerName);

    if (!adapter || !adapter.fetchAnalytics) {
      return err(
        new IngestChannelAnalyticsError(
          `Provider ${providerName} does not support analytics`,
          INGEST_ERRORS.ANALYTICS_NOT_SUPPORTED
        )
      );
    }

    const since = input.since ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const until = new Date();

    const analyticsResult = await adapter.fetchAnalytics({
      channelId: input.channelId,
      since,
      until,
    });

    if (!analyticsResult.ok) {
      const errorType = analyticsResult.error;
      if (errorType === "AUTH") {
        return err(
          new IngestChannelAnalyticsError(
            `Auth error for channel ${input.channelId}`,
            INGEST_ERRORS.AUTH_ERROR
          )
        );
      }
      return err(
        new IngestChannelAnalyticsError(
          `Network error fetching analytics for ${input.channelId}`,
          INGEST_ERRORS.PROVIDER_ERROR
        )
      );
    }

    const rawData = analyticsResult.value as {
      metrics?: Array<{
        date?: string;
        postId?: string;
        views?: number;
        likes?: number;
        comments?: number;
        shares?: number;
      }>;
    };

    const metrics = rawData.metrics ?? [];
    if (metrics.length === 0) {
      return ok({ ingested: 0, channelId: input.channelId });
    }

    const doWork = async (): Promise<
      Result<IngestChannelAnalyticsOutput, IngestChannelAnalyticsError>
    > => {
      const summaries = metrics.map((m) => ({
        postId: m.postId ?? null,
        channelId: input.channelId,
        provider: providerName.toUpperCase(),
        date: m.date ? new Date(m.date) : new Date(),
        views: m.views ?? 0,
        likes: m.likes ?? 0,
        comments: m.comments ?? 0,
        shares: m.shares ?? 0,
      }));

      const writeResult = await this.analyticsWriteRepository.upsertDailySummaries(summaries);
      if (!writeResult.ok) {
        return err(
          new IngestChannelAnalyticsError(
            `Failed to write analytics for ${input.channelId}`,
            INGEST_ERRORS.INTERNAL_ERROR,
            writeResult.error
          )
        );
      }

      return ok({ ingested: summaries.length, channelId: input.channelId });
    };

    try {
      if (this.unitOfWork) {
        let result: Result<IngestChannelAnalyticsOutput, IngestChannelAnalyticsError> = ok({
          ingested: 0,
          channelId: input.channelId,
        });
        await this.unitOfWork.executeInTransaction(async () => {
          result = await doWork();
        });
        return result;
      }
      return await doWork();
    } catch (error: unknown) {
      return err(
        new IngestChannelAnalyticsError(
          `Internal error ingesting analytics for ${input.channelId}`,
          INGEST_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
