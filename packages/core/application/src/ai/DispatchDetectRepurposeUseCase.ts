/**
 * @file DispatchDetectRepurposeUseCase.ts
 * @description Coordinator that finds accounts with active channels and
 *              enqueues one repurpose-detection job per account. Runs on a
 *              daily cron tick; the DETECT_REPURPOSE consumer then scans
 *              each account's high-performing posts and proposes repurpose
 *              candidates.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import type { QueuePort } from "@ports/core";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";
import type { ChannelQueryForIngestion } from "@core/domain/repositories/ChannelQueryForIngestion.js";

export interface DispatchDetectRepurposeInput {
  accountId?: string;
}

export interface DispatchDetectRepurposeOutput {
  dispatched: number;
  skipped: number;
}

export class DispatchDetectRepurposeError extends Error {
  constructor(message: string, cause?: Error) {
    super(message, { cause });
    this.name = "DispatchDetectRepurposeError";
  }
}

export class DispatchDetectRepurposeUseCase {
  constructor(
    private readonly channelQuery: ChannelQueryForIngestion,
    private readonly queue: QueuePort,
    private readonly queueName: string,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  /**
   * @method execute
   * @description Enqueues one DETECT_REPURPOSE job per account that owns at
   *   least one active channel. The dedupe key is date-bucketed per account
   *   so a given account is detected at most once per day even if the cron
   *   fires repeatedly.
   * @param input - Optional accountId to scope dispatch to a single account.
   * @returns Counts of enqueued vs skipped jobs.
   */
  async execute(
    input: DispatchDetectRepurposeInput
  ): Promise<Result<DispatchDetectRepurposeOutput, DispatchDetectRepurposeError>> {
    const doWork = async (): Promise<
      Result<DispatchDetectRepurposeOutput, DispatchDetectRepurposeError>
    > => {
      const channels = await this.channelQuery.findActiveChannels(input.accountId);
      const accountIds = [...new Set(channels.map((c) => c.accountId))];
      const day = new Date().toISOString().slice(0, 10);

      let dispatched = 0;
      let skipped = 0;

      for (const accountId of accountIds) {
        const enqueueResult = await this.queue.enqueue({
          payload: { accountId },
          dedupeKey: `detect-repurpose-${accountId}-${day}`,
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
        let result: Result<DispatchDetectRepurposeOutput, DispatchDetectRepurposeError> = ok({
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
        new DispatchDetectRepurposeError(
          "Failed to dispatch repurpose detection jobs",
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
