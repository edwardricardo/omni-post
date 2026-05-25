/**
 * @file inboxSyncConsumer.ts
 * @description In-process consumer for the INBOX_SYNC queue. Resolves
 *   SyncProviderCommentsUseCase from DI and runs it per job; on an AUTH failure
 *   (FORBIDDEN) it flags the channel for reauth via UpdateChannelAuthStateUseCase
 *   (preserving the behaviour the former apps/workers inbox-sync worker had) and
 *   throws so BullMQ retries / dead-letters. Hosted in apps/api (like the
 *   bulk-schedule / repurpose consumers) so it runs the canonical use case — no
 *   duplicated logic, no direct Prisma.
 * @layer infrastructure
 */

import type Redis from "ioredis";
import { createBullMQConsumerAdapter, QUEUE_NAMES } from "@adapters/queue-bullmq";
import { USE_CASE_ERRORS } from "@core/application/UseCase.js";
import type { SyncProviderCommentsUseCase } from "@core/application/inbox/SyncProviderCommentsUseCase.js";
import type { UpdateChannelAuthStateUseCase } from "@core/application/channels/UpdateChannelAuthStateUseCase.js";

/** Minimal logger surface (a pino child satisfies this structurally). */
export interface InboxSyncConsumerLogger {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

/** Handle returned by {@link startInboxSyncConsumer} for graceful shutdown. */
export interface InboxSyncConsumerHandle {
  close(): Promise<void>;
}

export interface StartInboxSyncConsumerDeps {
  readonly sync: SyncProviderCommentsUseCase;
  readonly markReauth: UpdateChannelAuthStateUseCase;
  readonly logger: InboxSyncConsumerLogger;
  /** Optional shared Redis connection; omit to let the consumer own one. */
  readonly connection?: Redis;
}

interface InboxSyncJob {
  channelId: string;
  accountId: string;
  projectId: string;
  since?: string;
}

/**
 * Terminal outcomes: bad input or the channel is gone. The former worker
 * logged-and-returned on a missing channel (no retry); re-throwing would loop a
 * deleted channel until the attempts are exhausted.
 */
const TERMINAL_CODES: ReadonlySet<string> = new Set([
  USE_CASE_ERRORS.VALIDATION_FAILED,
  USE_CASE_ERRORS.NOT_FOUND,
]);

/**
 * @function processInboxSyncJob
 * @description Runs one inbox-sync job through SyncProviderCommentsUseCase.
 *   Success or a terminal error resolves the job; FORBIDDEN (AUTH) flags the
 *   channel for reauth and a retryable error throws so BullMQ retries.
 * @param deps - The sync use case, the reauth use case, and a logger.
 * @param payload - The job payload (channelId, accountId, projectId, optional since ISO string).
 */
export async function processInboxSyncJob(
  deps: Pick<StartInboxSyncConsumerDeps, "sync" | "markReauth" | "logger">,
  payload: Record<string, unknown>
): Promise<void> {
  const job = payload as unknown as InboxSyncJob;
  const result = await deps.sync.execute({
    channelId: job.channelId,
    accountId: job.accountId,
    projectId: job.projectId,
    ...(job.since !== undefined && { since: new Date(job.since) }),
  });

  if (result.ok) {
    deps.logger.info(
      { channelId: job.channelId, synced: result.value.synced, skipped: result.value.skipped },
      "Inbox sync completed"
    );
    return;
  }

  if (TERMINAL_CODES.has(result.error.code)) {
    deps.logger.info(
      { channelId: job.channelId, reason: result.error.code },
      "Inbox sync skipped (terminal)"
    );
    return;
  }

  if (result.error.code === USE_CASE_ERRORS.FORBIDDEN) {
    await deps.markReauth.execute({
      channelId: job.channelId,
      reason: "Provider rejected credentials during inbox sync",
    });
  }

  deps.logger.warn(
    { channelId: job.channelId, error: result.error.code },
    "Inbox sync failed; retrying"
  );
  throw new Error(`Inbox sync failed for channel ${job.channelId}: ${result.error.code}`);
}

/**
 * @function startInboxSyncConsumer
 * @description Subscribes the in-process inbox consumer to INBOX_SYNC.
 * @param deps - Use cases, logger, and an optional shared Redis connection.
 * @returns A handle whose `close()` drains the consumer.
 */
export async function startInboxSyncConsumer(
  deps: StartInboxSyncConsumerDeps
): Promise<InboxSyncConsumerHandle> {
  const consumer = createBullMQConsumerAdapter({
    queueName: QUEUE_NAMES.INBOX_SYNC,
    ...(deps.connection !== undefined && { connection: deps.connection }),
  });

  await consumer.subscribe((job) =>
    processInboxSyncJob(
      { sync: deps.sync, markReauth: deps.markReauth, logger: deps.logger },
      job.payload
    )
  );

  return { close: () => consumer.close() };
}
