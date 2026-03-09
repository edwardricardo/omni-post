/**
 * @file inboxSyncJob.ts
 * @description BullMQ repeatable job for periodic social inbox comment synchronization.
 *   Fetches comments from provider APIs every 15 minutes to complement webhooks.
 * @layer infrastructure
 */

import { type SyncProviderCommentsUseCase } from "../application/inbox/SyncProviderCommentsUseCase.js";
import { type ChannelRepository } from "../domain/repositories/ChannelRepository.js";

/**
 * Configuration for the inbox sync job.
 */
export interface InboxSyncJobConfig {
  /** Interval in milliseconds (default: 15 minutes) */
  intervalMs?: number;
  /** Max channels to sync per run (default: 50) */
  batchSize?: number;
}

const DEFAULT_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const DEFAULT_BATCH_SIZE = 50;

/**
 * @class InboxSyncJob
 * @description Periodically fetches comments from all active channels.
 *   Designed to be called by a BullMQ repeatable job processor.
 */
export class InboxSyncJob {
  private readonly intervalMs: number;
  private readonly batchSize: number;

  constructor(
    private readonly syncUseCase: SyncProviderCommentsUseCase,
    private readonly channelRepository: ChannelRepository,
    config?: InboxSyncJobConfig
  ) {
    this.intervalMs = config?.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.batchSize = config?.batchSize ?? DEFAULT_BATCH_SIZE;
  }

  /**
   * @method getIntervalMs
   * @description Returns the configured sync interval.
   */
  get interval(): number {
    return this.intervalMs;
  }

  /**
   * @method execute
   * @description Runs a single sync cycle: fetches active channels and syncs comments.
   * @returns Summary of the sync cycle
   */
  async execute(): Promise<{
    channelsProcessed: number;
    totalSynced: number;
    totalSkipped: number;
    errors: number;
  }> {
    let channelsProcessed = 0;
    let totalSynced = 0;
    let totalSkipped = 0;
    let errors = 0;

    // TODO: Implement channel listing when ChannelRepository has findActiveChannels()
    // For now, this is a skeleton that will be wired to actual channel queries.
    // const channels = await this.channelRepository.findActiveChannels(this.batchSize);

    // Placeholder: sync logic will iterate channels and call syncUseCase.execute()
    // for (const channel of channels) {
    //   const result = await this.syncUseCase.execute({ channelId: channel.id });
    //   if (result.ok) {
    //     totalSynced += result.value.synced;
    //     totalSkipped += result.value.skipped;
    //   } else {
    //     errors += 1;
    //   }
    //   channelsProcessed += 1;
    // }

    return { channelsProcessed, totalSynced, totalSkipped, errors };
  }
}

/**
 * Queue name for inbox sync jobs.
 */
export const INBOX_SYNC_QUEUE = "INBOX_SYNC" as const;
