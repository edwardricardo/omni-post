/**
 * @file publishWorker.ts
 * @description BullMQ worker entry point that consumes publish jobs, dispatches
 *              to provider adapters, records metrics, and exposes a Prometheus
 *              HTTP endpoint. All side-effecting construction (consumer, scheduler,
 *              repo, Redis, metrics) is scoped inside `startPublishWorker()` so
 *              importing this module does NOT open any connections at import time.
 * @layer infrastructure
 */

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
import { verifyDatabaseAuth } from "./container/workerContainer.js";
import { decryptChannelCredentials } from "@shared/types";
import { CredentialResolver } from "./services/CredentialResolver.js";
import { DefaultBackgroundTaskScheduler } from "@observability/background-scheduler";
import client from "prom-client";
import { createLogger } from "@observability/logger";
import Redis from "ioredis";
import { WorkerMetrics } from "./metrics/workerMetrics.js";
import { PublishHandler } from "./publishHandler.js";
import type { PublishProvider } from "./publishHandler.js";
import type { PrismaClient } from "@infra/prisma";
import { env } from "./config/env.js";

const logger = createLogger("publish-worker");

/**
 * Registry of provider adapters indexed by provider name. Constructed at module
 * scope (pure, no I/O) to avoid rebuilding on every `startPublishWorker()` call.
 * The worker reads `job.data.provider` to route to the correct adapter.
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

/**
 * `PublishWorkerHandle` — the richer return type from `startPublishWorker`.
 * Carries the generic `ShutdownTarget` (passed to gracefulShutdown / composed
 * by bootstrap) plus the extras bootstrap needs: the repo for the shared
 * `DatabaseHealthChecker` and the prom Registry for the `/metrics` endpoint.
 */
export interface PublishWorkerHandle {
  /**
   * The generic drain contract — passed straight to `registerGracefulShutdown`
   * or composed by `bootstrap.ts` across multiple workers.
   * Teardown order: workers (drain jobs) → connections (notifyRedis.quit) →
   * prisma.$disconnect → afterTeardown (consumer.close + scheduler.shutdownAll).
   */
  target: ShutdownTarget;
  /**
   * Repo adapter for the shared `DatabaseHealthChecker`.
   * Replaces the former eager export `publishRepo`.
   */
  repo: ReturnType<typeof createPrismaRepoAdapter>;
  /**
   * Prometheus registry holding default Node metrics + WorkerMetrics gauges.
   * `bootstrap.ts` merges this into the unified `/metrics` endpoint.
   * Replaces the former eager export `publishMetricsRegistry`.
   */
  metricsRegistry: client.Registry;
}

export interface StartPublishWorkerOptions {
  /** Injected PrismaClient from the workers composition root. */
  prisma: PrismaClient;
  /**
   * When false, callers must register their own graceful-shutdown handler
   * (typical for composed bootstrap that drains multiple workers as a unit).
   * Default true: the worker registers its own SIGTERM / SIGINT handler.
   */
  registerShutdown?: boolean;
}

/**
 * @function startPublishWorker
 * @description Boots the publish BullMQ worker: constructs the consumer adapter,
 *              scheduler, metrics registry, saga-notify Redis connection, and
 *              the PublishHandler; subscribes to the publish queue; and returns
 *              a typed `PublishWorkerHandle` so `bootstrap.ts` can wire its
 *              parts into the unified health/metrics server and graceful shutdown.
 *
 *              ALL connection construction is scoped inside this function — the
 *              module does NOT open any connections at import time.
 *
 * @param options - `prisma` (required, injected) + `registerShutdown` flag.
 * @returns PublishWorkerHandle with `target`, `repo`, and `metricsRegistry`.
 */
export async function startPublishWorker(
  options: StartPublishWorkerOptions
): Promise<PublishWorkerHandle> {
  // Fail fast if DATABASE_URL credentials don't authenticate.
  await verifyDatabaseAuth();

  // Fail fast if PLATFORM_ENCRYPTION_KEY is missing (env module validates at
  // module load, so this is just for the decrypt closure below).
  const platformEncryptionKey = env.PLATFORM_ENCRYPTION_KEY;
  const decryptCredentialsForWorker = (envelope: {
    credentialsCiphertext: string;
    credentialsIv: string;
    credentialsAuthTag: string;
    credentialsKeyVersion: number;
  }) => decryptChannelCredentials(envelope, platformEncryptionKey);

  const scheduler = new DefaultBackgroundTaskScheduler({
    logger: {
      error: (msg, data) => logger.error({ data }, msg),
      info: (msg, data) => logger.info({ data }, msg),
      debug: (msg, data) => logger.debug({ data }, msg),
    },
  });

  const repo = createPrismaRepoAdapter({
    prisma: options.prisma,
    scheduler,
    decryptChannelCredentials: decryptCredentialsForWorker,
  });

  const metricsRegistry = new client.Registry();
  client.collectDefaultMetrics({ register: metricsRegistry });
  const workerMetrics = new WorkerMetrics(metricsRegistry);

  // Redis connection for saga pub/sub notifications (best-effort).
  // Intentionally uses env.REDIS_URL — no fallback (SECURITY_CANON §Secrets).
  const notifyRedis = new Redis(env.REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableReadyCheck: false,
    commandTimeout: 5_000,
    connectTimeout: 5_000,
  });
  notifyRedis.on("error", () => {
    // Suppress unhandled errors — saga notifications are best-effort.
  });

  const credentialResolver = new CredentialResolver(repo);

  const handler = new PublishHandler({
    repo,
    providerRegistry,
    credentialResolver,
    workerMetrics,
    logger,
    instrumentation: publishingInstrumentation,
    databaseInstrumentation,
    businessKPITracker,
    notifyRedis,
  });

  // Dedicated Redis connection for the BullMQ Worker. BullMQ requires
  // `maxRetriesPerRequest: null` because the Worker blocks on `BRPOPLPUSH`
  // indefinitely — the saga-notify `notifyRedis` above uses finite retries
  // and therefore cannot be shared as the Worker transport. The workers
  // executable owns its own composition root, so this connection is built
  // here (never crossing from the apps/api container) from the validated
  // `env.REDIS_URL` with no fallback (SECURITY_CANON §Secrets, CWE-798).
  const workerConnection = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
  });
  workerConnection.on("error", (error) => {
    logger.error({ err: error }, "Publish worker Redis connection error");
  });

  const consumer = createBullMQConsumerAdapter({
    queueName: QUEUE_NAMES.PUBLISH,
    connection: workerConnection,
  });

  const worker = await consumer.subscribe(async (job) => {
    const payload = job.payload as {
      postId: string;
      channelId: string;
      provider?: string;
      sagaId?: string;
    };
    await handler.handleJob({ payload, dedupeKey: job.dedupeKey });
  });

  worker.on("completed", (job) => {
    logger.debug({ jobId: job.id }, "Publish job completed");
  });

  worker.on("failed", (job, error) => {
    logger.error({ jobId: job?.id, error: error.message }, "Publish job failed");
  });

  workerMetrics.setHealthy();
  logger.info(
    { providers: Object.keys(providerRegistry) },
    "Worker subscribed. Awaiting jobs in 'publish'."
  );

  // ★ THE FIX — provably-correct teardown order:
  // gracefulShutdown.ts drains in fixed sequence:
  //   workers → queues → connections → prisma → afterTeardown
  //
  // 1. worker.close()         — stops fetching, AWAITS active jobs (saga-notify
  //                             Redis commands run here, while notifyRedis OPEN).
  // 2. connections.quit()     — only NOW; no job in flight → no command hits a
  //                             dead socket. Both the saga-notify connection and
  //                             the BullMQ Worker transport connection are quit
  //                             here, after the Worker has fully drained.
  // 3. options.prisma.$disconnect() — DB pool released.
  // 4. afterTeardown:
  //    a. consumer.close()    — Worker already closed (idempotent); the adapter
  //                             never quits the injected workerConnection (the
  //                             composition root owns it — quit in step 2).
  //    b. scheduler.shutdownAll() — cancels recurring tasks.
  const target: ShutdownTarget = {
    workers: [worker],
    connections: [notifyRedis, workerConnection],
    prisma: options.prisma,
    afterTeardown: async (): Promise<void> => {
      await consumer.close();
      const shutdownResult = await scheduler.shutdownAll();
      if (shutdownResult.timedOut) {
        logger.warn({ shutdownResult }, "BackgroundTaskScheduler shutdown timed out");
      }
    },
  };

  if (options.registerShutdown !== false) {
    registerGracefulShutdown({ name: "publish", target, logger });
  }

  return { target, repo, metricsRegistry };
}

// Standalone entry point: when invoked directly (e.g., `node dist/publishWorker.js`)
// rather than imported by `bootstrap.ts`, kick off the worker.
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  void startPublishWorker({
    prisma: (await import("./container/workerContainer.js")).workerPrisma,
  });
}
