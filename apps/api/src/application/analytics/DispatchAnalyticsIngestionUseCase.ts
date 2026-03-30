/**
 * @file DispatchAnalyticsIngestionUseCase.ts
 * @description Coordinator that finds all active channels and enqueues
 *              one analytics ingestion job per channel into BullMQ.
 *              Called by a cron repeatable job every 6 hours.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import type { QueuePort } from "@ports/core";
import type { UnitOfWork } from "../../domain/repositories/Repository.js";

export interface DispatchAnalyticsIngestionInput {
  accountId?: string;
}

export interface DispatchAnalyticsIngestionOutput {
  dispatched: number;
  skipped: number;
}

export class DispatchAnalyticsIngestionError extends Error {
  constructor(message: string, cause?: Error) {
    super(message, { cause });
    this.name = "DispatchAnalyticsIngestionError";
  }
}

export interface ChannelQueryForIngestion {
  findActiveChannels(accountId?: string): Promise<
    Array<{
      id: string;
      projectId: string;
      provider: string;
      accountId: string;
    }>
  >;
}

export class DispatchAnalyticsIngestionUseCase {
  constructor(
    private readonly channelQuery: ChannelQueryForIngestion,
    private readonly queue: QueuePort,
    private readonly queueName: string,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  async execute(
    input: DispatchAnalyticsIngestionInput
  ): Promise<Result<DispatchAnalyticsIngestionOutput, DispatchAnalyticsIngestionError>> {
    const doWork = async (): Promise<
      Result<DispatchAnalyticsIngestionOutput, DispatchAnalyticsIngestionError>
    > => {
      const channels = await this.channelQuery.findActiveChannels(input.accountId);

      let dispatched = 0;
      let skipped = 0;

      for (const channel of channels) {
        const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const dedupeKey = `analytics-ingest-${channel.id}-${since.toISOString().slice(0, 10)}`;

        const enqueueResult = await this.queue.enqueue({
          payload: {
            channelId: channel.id,
            accountId: channel.accountId,
            since: since.toISOString(),
          },
          dedupeKey,
        });

        if (enqueueResult.ok) {
          dispatched++;
        } else {
          skipped++;
        }
      }

      return ok({ dispatched, skipped });
    };

    try {
      if (this.unitOfWork) {
        let result: Result<DispatchAnalyticsIngestionOutput, DispatchAnalyticsIngestionError> = ok({
          dispatched: 0,
          skipped: 0,
        });
        await this.unitOfWork.executeInTransaction(async () => {
          result = await doWork();
        });
        return result;
      }
      return await doWork();
    } catch (error: unknown) {
      return err(
        new DispatchAnalyticsIngestionError(
          "Failed to dispatch analytics ingestion jobs",
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
