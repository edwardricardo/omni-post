/**
 * @file DispatchDetectTrendsUseCase.ts
 * @description Coordinator that finds accounts with active channels and
 *              enqueues one trend-detection job per account. Runs on a daily
 *              cron tick; the TREND_RADAR consumer then runs the
 *              `DetectTrendsUseCase` pipeline (fetch + score + persist).
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import type { QueuePort } from "@ports/core";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";
import type { ChannelQueryForIngestion } from "@core/domain/repositories/ChannelQueryForIngestion.js";

export interface DispatchDetectTrendsInput {
  accountId?: string;
}

export interface DispatchDetectTrendsOutput {
  dispatched: number;
  skipped: number;
}

export class DispatchDetectTrendsError extends Error {
  constructor(message: string, cause?: Error) {
    super(message, { cause });
    this.name = "DispatchDetectTrendsError";
  }
}

export class DispatchDetectTrendsUseCase {
  constructor(
    private readonly channelQuery: ChannelQueryForIngestion,
    private readonly queue: QueuePort,
    private readonly queueName: string,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  /**
   * @method execute
   * @description Enqueues one TREND_RADAR job per account that owns at least
   *   one active channel. Dedupe key is date-bucketed per account so each
   *   account is processed at most once per day even when the scheduler
   *   re-fires.
   * @param input - Optional accountId to scope dispatch to a single account.
   * @returns Counts of enqueued vs skipped jobs.
   */
  async execute(
    input: DispatchDetectTrendsInput
  ): Promise<Result<DispatchDetectTrendsOutput, DispatchDetectTrendsError>> {
    const doWork = async (): Promise<
      Result<DispatchDetectTrendsOutput, DispatchDetectTrendsError>
    > => {
      const channels = await this.channelQuery.findActiveChannels(input.accountId);
      const accountIds = [...new Set(channels.map((c) => c.accountId))];
      // Snapshot the dayKey once at dispatch time and propagate it through
      // the job payload. The downstream consumer (TREND_RADAR handler) and
      // the persistence port use this string as the canonical bucket. The
      // unique constraint `(accountId, dayKey, topic)` then deduplicates
      // even when the consumer's wall clock crosses midnight during a run.
      const dayKey = new Date().toISOString().slice(0, 10);

      let dispatched = 0;
      let skipped = 0;

      for (const accountId of accountIds) {
        const enqueueResult = await this.queue.enqueue({
          payload: { accountId, dayKey },
          dedupeKey: `trend-radar-${accountId}-${dayKey}`,
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
        let result: Result<DispatchDetectTrendsOutput, DispatchDetectTrendsError> = ok({
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
        new DispatchDetectTrendsError(
          "Failed to dispatch trend-detection jobs",
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
