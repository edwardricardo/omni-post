/**
 * @file analyticsIngestConsumer.ts
 * @description In-process consumer for the ANALYTICS_AGGREGATION queue. Resolves
 *   IngestChannelAnalyticsUseCase from DI and runs it per job; on an AUTH failure
 *   it flags the channel for reauth via UpdateChannelAuthStateUseCase (preserving
 *   the behaviour the former apps/workers analytics worker had) and throws so
 *   BullMQ retries / dead-letters. Hosted in apps/api (like the bulk-schedule /
 *   repurpose consumers) so it runs the canonical use case — no duplicated logic,
 *   no direct Prisma.
 * @layer infrastructure
 */

import type { Redis } from "ioredis";
import { createBullMQConsumerAdapter, QUEUE_NAMES } from "@adapters/queue-bullmq";
import {
  type IngestChannelAnalyticsUseCase,
  INGEST_ERRORS,
} from "@core/analytics/IngestChannelAnalyticsUseCase.js";
import type { UpdateChannelAuthStateUseCase } from "@core/channels/UpdateChannelAuthStateUseCase.js";

/** Minimal logger surface (a pino child satisfies this structurally). */
export interface AnalyticsIngestConsumerLogger {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

/** Handle returned by {@link startAnalyticsIngestConsumer} for graceful shutdown. */
export interface AnalyticsIngestConsumerHandle {
  close(): Promise<void>;
}

export interface StartAnalyticsIngestConsumerDeps {
  readonly ingest: IngestChannelAnalyticsUseCase;
  readonly markReauth: UpdateChannelAuthStateUseCase;
  readonly logger: AnalyticsIngestConsumerLogger;
  /**
   * Shared Redis connection (composition-root-owned). Required — the consumer
   * adapter never self-constructs one from env; index.ts injects
   * `TOKENS.BullMQWorkerConnection` here.
   */
  readonly connection: Redis;
}

interface AnalyticsIngestJob {
  channelId: string;
  accountId: string;
  since?: string;
}

/**
 * Terminal outcomes: the channel is gone or the provider has no analytics. The
 * former worker logged-and-returned on these (no retry); re-throwing would loop
 * a deleted/unsupported channel until the attempts are exhausted.
 */
const TERMINAL_CODES: ReadonlySet<string> = new Set([
  INGEST_ERRORS.CHANNEL_NOT_FOUND,
  INGEST_ERRORS.ANALYTICS_NOT_SUPPORTED,
]);

/**
 * @function processAnalyticsIngestJob
 * @description Runs one analytics job through IngestChannelAnalyticsUseCase.
 *   Success or a terminal error resolves the job; AUTH flags the channel for
 *   reauth and a retryable error throws so BullMQ retries.
 * @param deps - The ingest use case, the reauth use case, and a logger.
 * @param payload - The job payload (channelId, accountId, optional since ISO string).
 */
export async function processAnalyticsIngestJob(
  deps: Pick<StartAnalyticsIngestConsumerDeps, "ingest" | "markReauth" | "logger">,
  payload: Record<string, unknown>
): Promise<void> {
  const job = payload as unknown as AnalyticsIngestJob;
  const result = await deps.ingest.execute({
    channelId: job.channelId,
    accountId: job.accountId,
    ...(job.since !== undefined && { since: new Date(job.since) }),
  });

  if (result.ok) {
    deps.logger.info(
      { channelId: job.channelId, ingested: result.value.ingested },
      "Analytics ingested"
    );
    return;
  }

  if (TERMINAL_CODES.has(result.error.code)) {
    deps.logger.info(
      { channelId: job.channelId, reason: result.error.code },
      "Analytics ingest skipped (terminal)"
    );
    return;
  }

  if (result.error.code === INGEST_ERRORS.AUTH_ERROR) {
    await deps.markReauth.execute({
      channelId: job.channelId,
      reason: "Provider rejected credentials during analytics ingestion",
    });
  }

  deps.logger.warn(
    { channelId: job.channelId, error: result.error.code },
    "Analytics ingest failed; retrying"
  );
  throw new Error(`Analytics ingest failed for channel ${job.channelId}: ${result.error.code}`);
}

/**
 * @function startAnalyticsIngestConsumer
 * @description Subscribes the in-process analytics consumer to ANALYTICS_AGGREGATION.
 * @param deps - Use cases, logger, and the shared Redis connection.
 * @returns A handle whose `close()` drains the consumer.
 */
export async function startAnalyticsIngestConsumer(
  deps: StartAnalyticsIngestConsumerDeps
): Promise<AnalyticsIngestConsumerHandle> {
  const consumer = createBullMQConsumerAdapter({
    queueName: QUEUE_NAMES.ANALYTICS_AGGREGATION,
    connection: deps.connection,
  });

  await consumer.subscribe((job) =>
    processAnalyticsIngestJob(
      { ingest: deps.ingest, markReauth: deps.markReauth, logger: deps.logger },
      job.payload
    )
  );

  return { close: () => consumer.close() };
}
