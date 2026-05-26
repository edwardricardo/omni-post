/**
 * @file DispatchInboxSyncUseCase.ts
 * @description Coordinator that finds all active channels with inbox support
 *              and enqueues one sync job per channel into BullMQ.
 *              Called by a cron repeatable job every 30 minutes.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import type { QueuePort } from "@ports/core";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";
import type { ChannelQueryForIngestion } from "@core/domain/repositories/ChannelQueryForIngestion.js";

export interface DispatchInboxSyncInput {
  accountId?: string;
}

export interface DispatchInboxSyncOutput {
  dispatched: number;
  skipped: number;
}

export class DispatchInboxSyncError extends Error {
  constructor(message: string, cause?: Error) {
    super(message, { cause });
    this.name = "DispatchInboxSyncError";
  }
}

export class DispatchInboxSyncUseCase {
  constructor(
    private readonly channelQuery: ChannelQueryForIngestion,
    private readonly queue: QueuePort,
    private readonly queueName: string,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  async execute(
    input: DispatchInboxSyncInput
  ): Promise<Result<DispatchInboxSyncOutput, DispatchInboxSyncError>> {
    const doWork = async (): Promise<Result<DispatchInboxSyncOutput, DispatchInboxSyncError>> => {
      const channels = await this.channelQuery.findActiveChannels(input.accountId);

      let dispatched = 0;
      let skipped = 0;
      const since = new Date(Date.now() - 60 * 60 * 1000);

      for (const channel of channels) {
        const dedupeKey = `inbox-sync-${channel.id}-${since.toISOString().slice(0, 16)}`;

        const enqueueResult = await this.queue.enqueue({
          payload: {
            channelId: channel.id,
            accountId: channel.accountId,
            projectId: channel.projectId,
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
        let result: Result<DispatchInboxSyncOutput, DispatchInboxSyncError> = ok({
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
        new DispatchInboxSyncError(
          "Failed to dispatch inbox sync jobs",
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
