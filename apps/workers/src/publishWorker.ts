/**
 * @file publishWorker.ts
 * @description BullMQ worker entry point that consumes publish jobs, dispatches to provider
 *              adapters, records metrics, and exposes a Prometheus HTTP endpoint.
 * @layer infrastructure
 */
import dotenv from "dotenv";
dotenv.config({ path: "../../.env" });

// Initialize OpenTelemetry BEFORE any other imports
import {
  publishingInstrumentation,
  databaseInstrumentation,
  businessKPITracker,
} from "./telemetry/initialization.js";

import { createXAdapter } from "@providers/x";
import { createInstagramAdapter } from "@providers/instagram";
import { createFacebookAdapter } from "@providers/facebook";
import { createYouTubeAdapter } from "@providers/youtube";
import { createTikTokAdapter } from "@providers/tiktok";
import { createSnapchatAdapter } from "@providers/snapchat";
import { createTelegramAdapter } from "@providers/telegram";
import { createPinterestAdapter } from "@providers/pinterest";
import { createLinkedInAdapter } from "@providers/linkedin";
import { createBlueskyAdapter } from "@providers/bluesky";
import { createThreadsAdapter } from "@providers/threads";
import { createBullMQConsumerAdapter, QUEUE_NAMES } from "@adapters/queue-bullmq";
import { registerGracefulShutdown, type ShutdownTarget } from "./lib/gracefulShutdown.js";
import { createPrismaRepoAdapter } from "@adapters/db-prisma";
import { verifyDatabaseAuth } from "@infra/prisma";
import { decryptChannelCredentials } from "@shared/types";
import { CredentialResolver } from "./services/CredentialResolver.js";

// PLATFORM_ENCRYPTION_KEY is required for decrypting Channel.credentials.
// Workers fail fast if missing — no plaintext fallback.
const platformEncryptionKey = process.env.PLATFORM_ENCRYPTION_KEY;
if (!platformEncryptionKey) {
  throw new Error("PLATFORM_ENCRYPTION_KEY is required for the publish worker");
}
const decryptCredentialsForWorker = (envelope: {
  credentialsCiphertext: string;
  credentialsIv: string;
  credentialsAuthTag: string;
  credentialsKeyVersion: number;
}) => decryptChannelCredentials(envelope, platformEncryptionKey);
import { DefaultBackgroundTaskScheduler } from "@observability/background-scheduler";
import client from "prom-client";
import { createLogger } from "@observability/logger";
import Redis from "ioredis";
import { WorkerMetrics } from "./metrics/workerMetrics.js";
import { PublishHandler } from "./publishHandler.js";
import type { PublishProvider } from "./publishHandler.js";

const consumer = createBullMQConsumerAdapter({ queueName: QUEUE_NAMES.PUBLISH });
const logger = createLogger("publish-worker");
const scheduler = new DefaultBackgroundTaskScheduler({
  logger: {
    error: (msg, data) => logger.error({ data }, msg),
    info: (msg, data) => logger.info({ data }, msg),
    debug: (msg, data) => logger.debug({ data }, msg),
  },
});
/**
 * @description Repo adapter bound to the workers' PrismaClient. Exported so
 *   `bootstrap.ts` can wire it into the shared `DatabaseHealthChecker` without
 *   constructing a second adapter (avoids duplicating the decrypt closure).
 */
export const publishRepo = createPrismaRepoAdapter({
  scheduler,
  decryptChannelCredentials: decryptCredentialsForWorker,
});

/**
 * Registry of provider adapters indexed by provider name.
 * Used to route publish jobs to the correct social media platform adapter.
 *
 * The worker reads `job.data.provider` to determine which adapter handles
 * the publishing. If a job doesn't specify a provider, it defaults to "x"
 * for backwards compatibility with existing jobs in the queue.
 */
const providerRegistry: Record<string, PublishProvider> = {
  x: createXAdapter({ logger }),
  instagram: createInstagramAdapter({ logger }),
  facebook: createFacebookAdapter({ logger }),
  youtube: createYouTubeAdapter({ logger }),
  tiktok: createTikTokAdapter({ logger }),
  snapchat: createSnapchatAdapter({ logger }),
  telegram: createTelegramAdapter({ logger }),
  pinterest: createPinterestAdapter({ logger }),
  linkedin: createLinkedInAdapter({ logger }),
  bluesky: createBlueskyAdapter({ logger }),
  threads: createThreadsAdapter({ logger }),
};

const credentialResolver = new CredentialResolver(publishRepo);

/**
 * @description Prometheus registry holding default Node metrics + WorkerMetrics
 *   gauges. Exported so `bootstrap.ts` can merge it into the aggregated
 *   `/metrics` endpoint served from the unified health server.
 */
export const publishMetricsRegistry = new client.Registry();
client.collectDefaultMetrics({ register: publishMetricsRegistry });
const workerMetrics = new WorkerMetrics(publishMetricsRegistry);

// Redis connection for saga pub/sub notifications (best-effort)
const notifyRedis = new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
  lazyConnect: true,
  maxRetriesPerRequest: 1,
  enableReadyCheck: false,
  // Bound the ioredis "wait forever" defaults: a hung Redis must not stall
  // the worker. 5 s per command + 5 s connect; enough for healthy clusters,
  // fail-fast for a black hole.
  commandTimeout: 5_000,
  connectTimeout: 5_000,
});
notifyRedis.on("error", () => {
  // Suppress unhandled errors -- saga notifications are best-effort
});

// Create the handler with all real dependencies
const handler = new PublishHandler({
  repo: publishRepo,
  providerRegistry,
  credentialResolver,
  workerMetrics,
  logger,
  instrumentation: publishingInstrumentation,
  databaseInstrumentation,
  businessKPITracker,
  notifyRedis,
});

export interface StartPublishWorkerOptions {
  /**
   * When false, callers must register their own graceful-shutdown handler
   * (typical for composed bootstrap that drains multiple workers as a unit).
   * Default true: the worker registers its own SIGTERM / SIGINT handler.
   */
  registerShutdown?: boolean;
}

/**
 * @function startPublishWorker
 * @description Boots the publish BullMQ worker, metrics HTTP server, and
 *              auxiliary connections (notifyRedis for saga signals, BullMQ
 *              consumer adapter, recurring-task scheduler).
 * @returns ShutdownTarget so a composer (`bootstrap.ts`) can drain it.
 */
export async function startPublishWorker(
  options?: StartPublishWorkerOptions
): Promise<ShutdownTarget> {
  // Fail fast if DATABASE_URL credentials don't authenticate (typically a
  // stale Postgres volume after a password rotation without `down -v`).
  await verifyDatabaseAuth();

  await consumer.subscribe(async (job) => {
    const payload = job.payload as {
      postId: string;
      channelId: string;
      provider?: string;
      sagaId?: string;
    };
    await handler.handleJob({
      payload,
      dedupeKey: job.dedupeKey,
    });
  });
  workerMetrics.setHealthy();
  logger.info(
    { providers: Object.keys(providerRegistry) },
    "Worker subscribed. Awaiting jobs in 'publish'."
  );

  // Graceful shutdown — closes the consumer (waits for active jobs), the
  // scheduler (cancels recurring tasks), and the saga notification Redis
  // connection. The shared helper covers SIGTERM and SIGINT identically.
  const target: ShutdownTarget = {
    connections: [notifyRedis],
    afterTeardown: async () => {
      await consumer.close();
      const shutdownResult = await scheduler.shutdownAll();
      if (shutdownResult.timedOut) {
        logger.warn({ shutdownResult }, "BackgroundTaskScheduler shutdown timed out");
      }
    },
  };

  if (options?.registerShutdown !== false) {
    registerGracefulShutdown({ name: "publish", target, logger });
  }

  return target;
}

// Standalone entry point: when invoked directly (e.g., `node dist/publishWorker.js`)
// rather than imported by `bootstrap.ts`, kick off the worker.
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  void startPublishWorker();
}
